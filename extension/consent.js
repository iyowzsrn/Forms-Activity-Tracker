(function () {
  var params = new URLSearchParams(location.search);
  var formTabParam = params.get("tab");
  var formTabId = formTabParam && !isNaN(Number(formTabParam)) ? Number(formTabParam) : null;

  var nameEl = document.getElementById("name");
  var idEl = document.getElementById("sid");
  var agreeEl = document.getElementById("agree");
  var btn = document.getElementById("agreeBtn");
  var errEl = document.getElementById("error");

  function show(id) {
    ["formBox", "doneBox", "declinedBox"].forEach(function (b) {
      document.getElementById(b).classList.toggle("hidden", b !== id);
    });
  }

  function validate() {
    btn.disabled = !(nameEl.value.trim().length >= 2 && idEl.value.trim().length >= 1 && agreeEl.checked);
  }
  nameEl.addEventListener("input", validate);
  idEl.addEventListener("input", validate);
  agreeEl.addEventListener("change", validate);

  chrome.storage.local.get("consent", function (data) {
    if (data && data.consent) {
      nameEl.value = data.consent.name || "";
      idEl.value = data.consent.studentId || "";
    }
    validate();
  });

  function closeThisTab() {
    chrome.tabs.getCurrent(function (tab) {
      if (tab && tab.id !== undefined) chrome.tabs.remove(tab.id);
    });
  }

  function finish() {
    if (formTabId !== null) {
      chrome.tabs.update(formTabId, { active: true }, function () {
        void chrome.runtime.lastError;
        closeThisTab();
      });
    }
  }

  btn.addEventListener("click", function () {
    btn.disabled = true;
    errEl.textContent = "";
    chrome.runtime.sendMessage(
      { type: "CONSENT_AGREE", name: nameEl.value, studentId: idEl.value, formTabId: formTabId },
      function (res) {
        if (chrome.runtime.lastError || !res || !res.ok) {
          errEl.textContent = (res && res.error) || "Something went wrong. Please try again.";
          validate();
          return;
        }
        if (formTabId !== null) {
          document.getElementById("doneText").textContent = "Thank you. Returning you to your exam form...";
          show("doneBox");
          setTimeout(finish, 1500);
        } else {
          show("doneBox");
        }
      }
    );
  });

  document.getElementById("declineBtn").addEventListener("click", function () { show("declinedBox"); });
  document.getElementById("closeBtn").addEventListener("click", closeThisTab);
  document.getElementById("closeBtn2").addEventListener("click", closeThisTab);
})();
