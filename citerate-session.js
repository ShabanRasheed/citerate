// Shared prototype session across the Phase 14 files.
// One localStorage record, so claiming a scan in 14a walks you into 14b, and so on.
(function () {
  if (window.CiterateSession) return;
  var KEY = "citerate.proto.session.v1";
  var DEFAULTS = {
    domain: "",
    scanned: false,
    claimed: false,
    email: "",
    verified: false,
    onboarded: false,
    plan: "free",
    lastPhase: "",
  };
  var subs = [];

  function read() {
    try {
      var raw = localStorage.getItem(KEY);
      if (!raw) return Object.assign({}, DEFAULTS);
      return Object.assign({}, DEFAULTS, JSON.parse(raw) || {});
    } catch (e) {
      return Object.assign({}, DEFAULTS);
    }
  }
  function write(next) {
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch (e) {}
    subs.forEach(function (fn) { try { fn(next); } catch (e) {} });
  }

  window.CiterateSession = {
    KEY: KEY,
    defaults: function () { return Object.assign({}, DEFAULTS); },
    get: read,
    patch: function (partial) {
      var next = Object.assign(read(), partial || {});
      write(next);
      return next;
    },
    reset: function () {
      var next = Object.assign({}, DEFAULTS);
      write(next);
      return next;
    },
    subscribe: function (fn) {
      subs.push(fn);
      var onStorage = function (e) { if (e.key === KEY) fn(read()); };
      window.addEventListener("storage", onStorage);
      return function () {
        subs = subs.filter(function (f) { return f !== fn; });
        window.removeEventListener("storage", onStorage);
      };
    },
  };
})();
