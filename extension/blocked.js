(function () {
  var params = new URLSearchParams(location.search);
  var original = params.get("u") || "";
  var label = "This page";
  var safeUrl = "";

  try {
    var u = new URL(original);
    if (u.protocol === "http:" || u.protocol === "https:") {
      label = u.hostname;
      safeUrl = u.href;
    } else if (u.protocol === "file:") {
      label = "A file on this computer";
    } else {
      label = "This browser page";
    }
  } catch (e) {}

  document.getElementById("site").textContent = label;

  function closeThisTab() {
    chrome.tabs.getCurrent(function (tab) {
      if (tab && tab.id !== undefined) chrome.tabs.remove(tab.id);
    });
  }

  document.getElementById("closeBtn").addEventListener("click", closeThisTab);
  document.getElementById("closeBtn2").addEventListener("click", closeThisTab);
  document.getElementById("backBtn").addEventListener("click", function () {
    if (history.length > 1) history.back(); else closeThisTab();
  });

  function showState(active) {
    document.getElementById("activeBox").classList.toggle("hidden", !active);
    document.getElementById("endedBox").classList.toggle("hidden", active);
    var link = document.getElementById("openLink");
    if (!active && safeUrl) {
      link.href = safeUrl;
      link.classList.remove("hidden");
    }
  }

  chrome.storage.local.get("s", function (data) {
    showState(!!(data && data.s && data.s.active));
  });

  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area === "local" && changes.s) {
      showState(!!(changes.s.newValue && changes.s.newValue.active));
    }
  });
})();
