const messages = {
  foreign: {
    title: "👖🔥 Likely foreign-made",
    message: "A closely matching photo was verified on a target marketplace. See the evidence below.",
  },
  domestic: {
    title: "👖 Likely domestic",
    message: "No matching marketplace photo was verified in the search results checked. This does not prove domestic manufacture.",
  },
  incomplete: {
    title: "Unable to verify",
    message: "Some checks could not finish. No jeans verdict has been assigned.",
  },
  "verification-unavailable": {
    title: "Marketplace verification unavailable",
    message: "Image references were collected automatically. Without a marketplace image-matching source, duplicate checks cannot finish. Neither the fire nor the jeans verdict has been assigned.",
  },
  "no-images": {
    title: "No image references found",
    message: "There are no image references in the accessible page content to check. This is not a no-duplicate verdict.",
  },
  "collection-unavailable": {
    title: "This page could not be scanned",
    message: "Chrome protects browser pages, the Chrome Web Store, and some other pages from extensions. Activate Pants on Fire on an ordinary HTTP or HTTPS webpage instead.",
  },
};

document.getElementById("close").addEventListener("click", () => window.close());

async function showCompletedOutcome() {
  const params = new URLSearchParams(location.search);
  const tabId = params.get("tab");
  let message = {
    title: "No completed check available",
    message: "Activate Pants on Fire from Chrome's toolbar on the webpage you want to check.",
  };
  try {
    if (/^\d+$/.test(tabId || "")) {
      const key = `scan:${tabId}`;
      const stored = await chrome.storage.session.get(key);
      if (stored[key]?.scanId === params.get("scan")) {
        message = messages[stored[key].kind] || message;
        const result = stored[key];
        document.getElementById("verdict").textContent = `${result.checked ?? 0} of ${result.total ?? 0} images searched`;
        for (const match of result.matches || []) {
          const li = document.createElement("li");
          const a = document.createElement("a");
          a.textContent = `Matching photo on ${match.marketplace}`;
          a.href = match.listing;
          a.target = "_blank";
          a.rel = "noopener noreferrer";
          li.append(a);
          document.getElementById("evidence").append(li);
        }
        for (const failure of result.failures || []) {
          const li = document.createElement("li");
          li.textContent = failure;
          document.getElementById("evidence").append(li);
        }
      }
    }
  } catch {
    message = {
      title: "The outcome could not be read",
      message: "Activate the extension again. No duplicate verdict has been assigned.",
    };
  }
  document.getElementById("outcome-title").textContent = message.title;
  document.getElementById("outcome-message").textContent = message.message;
  document.getElementById("outcome").hidden = false;
}

showCompletedOutcome();
