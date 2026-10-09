// This function must be self-contained: Chrome serializes it into the page's
// isolated world. Collect a snapshot; never scroll, select, fetch, or modify DOM.
export function collectPageImages() {
  const images = new Map();
  const visited = new Set();
  const limitations = new Set();

  function add(raw, base, source) {
    if (typeof raw !== "string" || !raw.trim()) return;
    try {
      const url = new URL(raw.trim(), base);
      if (!["http:", "https:", "data:", "blob:"].includes(url.protocol)) return;
      if (url.protocol === "data:" && !/^data:image\//i.test(url.href)) return;
      const existing = images.get(url.href);
      if (existing) {
        if (!existing.sources.includes(source)) existing.sources.push(source);
      } else {
        images.set(url.href, { url: url.href, sources: [source] });
      }
    } catch {
      // Invalid references aren't URLs and cannot be checked.
    }
  }

  // Parse srcset without splitting data-URL commas. Whitespace descriptors
  // (1x/2x/400w) aren't part of the URL.
  function srcset(value, base, source) {
    let rest = value || "";
    while (rest.length) {
      rest = rest.replace(/^[\s,]+/, "");
      if (!rest) break;
      const match = rest.match(/^\S+/);
      if (!match) break;
      let url = match[0];
      rest = rest.slice(url.length);
      const trailingComma = /,+$/.test(url);
      url = url.replace(/,+$/, "");
      add(url, base, source);
      if (!trailingComma) {
        const delimiter = rest.indexOf(",");
        rest = delimiter === -1 ? "" : rest.slice(delimiter + 1);
      }
    }
  }

  function cssUrls(value, base) {
    const expression = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;
    for (const match of (value || "").matchAll(expression)) {
      add(match[1] ?? match[2] ?? match[3], base, "css");
    }
  }

  function cssDeclarations(value, base) {
    const declarations = /(?:background(?:-image)?|border-image(?:-source)?|list-style(?:-image)?|content|mask(?:-image)?|cursor)\s*:\s*([^;{}]+)/gi;
    for (const match of (value || "").matchAll(declarations)) {
      cssUrls(match[1], base);
    }
  }

  function jsonImages(value, base, inImage = false) {
    if (typeof value === "string") {
      if (inImage) add(value, base, "structured-data");
    } else if (Array.isArray(value)) {
      for (const entry of value) jsonImages(entry, base, inImage);
    } else if (value && typeof value === "object") {
      const imageObject = value["@type"] === "ImageObject";
      for (const [key, entry] of Object.entries(value)) {
        jsonImages(entry, base,
          /^(image|thumbnailUrl|logo)$/i.test(key) ||
          ((inImage || imageObject) && /^(url|contentUrl)$/i.test(key)));
      }
    }
  }

  function visit(root, doc) {
    if (!root || visited.has(root)) return;
    visited.add(root);
    const base = doc.baseURI;
    for (const node of root.querySelectorAll("*")) {
      const tag = node.localName?.toLowerCase();
      if (tag === "img" || tag === "source") {
        if (tag === "img") {
          add(node.currentSrc, base, "img");
          add(node.getAttribute("src"), base, "img");
          // No visibility, size, or maximum-count filter.
          for (const attr of ["data-src", "data-original", "data-lazy-src",
            "data-url", "data-image", "data-original-src", "data-echo", "data-lazy"]) {
            add(node.getAttribute(attr), base, "lazy-image");
          }
        }
        for (const attr of ["srcset", "data-srcset", "data-lazy-srcset"]) {
          srcset(node.getAttribute(attr), base, "srcset");
        }
      }
      if (tag === "video") add(node.getAttribute("poster"), base, "poster");
      if (tag === "input" && node.type === "image") {
        add(node.getAttribute("src"), base, "image-input");
      }
      for (const attr of ["data-background", "data-bg", "data-background-image"]) {
        add(node.getAttribute(attr), base, "lazy-background");
      }
      if (tag === "a") {
        const href = node.getAttribute("href") || "";
        if (/\.(png|jpe?g|gif|webp|avif|svg|bmp|ico|tiff?)(?:[?#]|$)/i.test(href) ||
          /^image\//i.test(node.type || "")) add(href, base, "linked-image");
      }
      if (tag === "image") {
        add(node.getAttribute("href") || node.getAttribute("xlink:href"), base, "svg-image");
      }
      if (["object", "embed"].includes(tag) && /^image\//i.test(node.type || "")) {
        add(node.getAttribute(tag === "object" ? "data" : "src"), base, "embedded-image");
      }
      if (tag === "meta" && /^(og:image(:url|:secure_url)?|twitter:image(:src)?)$/i.test(
        node.getAttribute("property") || node.getAttribute("name") || "")) {
        add(node.getAttribute("content"), base, "metadata");
      }
      if (tag === "link" && (
        node.rel === "image_src" || node.rel?.includes("icon") ||
        (node.rel === "preload" && node.getAttribute("as") === "image"))) {
        add(node.getAttribute("href"), base, "image-link");
        srcset(node.getAttribute("imagesrcset"), base, "preload-srcset");
      }
      if (tag === "script" && node.type === "application/ld+json") {
        try { jsonImages(JSON.parse(node.textContent), base); } catch { /* Invalid JSON-LD. */ }
      }
      if (tag === "style") cssDeclarations(node.textContent, base);
      cssDeclarations(node.getAttribute("style"), base);
      try {
        const style = doc.defaultView.getComputedStyle(node);
        cssUrls(style.backgroundImage, base);
        cssUrls(style.listStyleImage, base);
        cssUrls(style.borderImageSource, base);
        cssUrls(style.maskImage, base);
        cssUrls(style.content, base);
        for (const pseudo of ["::before", "::after"]) {
          const pseudoStyle = doc.defaultView.getComputedStyle(node, pseudo);
          cssUrls(pseudoStyle.backgroundImage, base);
          cssUrls(pseudoStyle.content, base);
        }
      } catch { /* Detached/inaccessible elements have no computed styles. */ }
      if (node.shadowRoot) visit(node.shadowRoot, doc);
      if (tag === "template") visit(node.content, doc);
      if (tag === "noscript" && node.textContent) {
        const fallback = new DOMParser().parseFromString(node.textContent, "text/html");
        visit(fallback, doc);
      }
      if (tag === "iframe" || tag === "frame") {
        try {
          if (node.contentDocument) visit(node.contentDocument, node.contentDocument);
          else limitations.add("Cross-origin frames cannot be inspected with activeTab permission.");
        } catch {
          limitations.add("Cross-origin frames cannot be inspected with activeTab permission.");
        }
      }
    }
  }

  visit(document, document);
  return {
    images: [...images.values()],
    limitations: [...limitations],
  };
}
