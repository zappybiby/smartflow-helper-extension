(function () {
  "use strict";

  var REQUEST_EVENT = "smartflow-helper:request";
  var RESPONSE_EVENT = "smartflow-helper:response";
  var DEFAULT_TIMEOUT_MS = 10000;
  var nextId = 1;

  function callPageHelper(method, args, timeoutMs) {
    return new Promise(function (resolve, reject) {
      var id = "sfh-" + Date.now() + "-" + nextId++;
      var timer = window.setTimeout(function () {
        document.removeEventListener(RESPONSE_EVENT, onResponse);
        reject(new Error("Smart Flow helper timed out"));
      }, timeoutMs || DEFAULT_TIMEOUT_MS);

      function onResponse(event) {
        var detail = event.detail || {};

        if (detail.id !== id) {
          return;
        }

        window.clearTimeout(timer);
        document.removeEventListener(RESPONSE_EVENT, onResponse);

        if (!detail.ok) {
          reject(new Error(detail.error || "Smart Flow helper failed"));
          return;
        }

        resolve(detail.result);
      }

      document.addEventListener(RESPONSE_EVENT, onResponse);
      document.dispatchEvent(new CustomEvent(REQUEST_EVENT, {
        detail: {
          id: id,
          method: method || "inspect",
          args: Array.isArray(args) ? args : []
        }
      }));
    });
  }

  window.SmartFlowHelperBridge = {
    callPageHelper: callPageHelper
  };

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== "smartflow-helper") {
      return false;
    }

    callPageHelper(message.method, message.args, message.timeoutMs).then(function (result) {
      sendResponse({
        ok: true,
        result: result
      });
    }).catch(function (error) {
      sendResponse({
        ok: false,
        error: error && error.message ? error.message : String(error)
      });
    });

    return true;
  });
})();
