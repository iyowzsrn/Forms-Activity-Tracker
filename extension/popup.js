(function () {
  function openConsent() {
    chrome.tabs.create({ url: chrome.runtime.getURL("consent.html") });
    window.close();
  }

  function render() {
    chrome.storage.local.get(["consent", "s"], function (data) {
      var c = data && data.consent;
      var s = data && data.s;
      document.getElementById("onBox").classList.toggle("hidden", !c);
      document.getElementById("offBox").classList.toggle("hidden", !!c);
      if (!c) return;

      var when = c.at ? new Date(c.at).toLocaleString() : "";
      document.getElementById("who").textContent = c.name + " (" + c.studentId + ")" + (when ? " - agreed " + when : "");

      var line = document.getElementById("sessionLine");
      if (s && s.active) {
        var end = new Date(s.examEnd - (s.offset || 0));
        var endText = end.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
        var text = "Exam in progress: " + s.examName + ". ";
        text += s.lock
          ? "Restrictions stay on until " + endText + ", even if you close the form."
          : "Restrictions end when you close the form (exam ends " + endText + ").";
        line.textContent = text;
        line.className = "rec";
      } else {
        line.textContent = "No exam is in progress.";
        line.className = "";
      }
    });
  }

  document.getElementById("enableBtn").addEventListener("click", openConsent);
  document.getElementById("reviewBtn").addEventListener("click", openConsent);
  document.getElementById("withdrawBtn").addEventListener("click", function () {
    if (!confirm("Withdraw your consent? Monitoring and restrictions will stop and the withdrawal will be recorded.")) return;
    chrome.runtime.sendMessage({ type: "CONSENT_WITHDRAW" }, function () {
      void chrome.runtime.lastError;
      render();
    });
  });

  render();
})();
