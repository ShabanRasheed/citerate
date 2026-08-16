// Single source for the prototype's phone/desktop values.
//
// The phone column is transcribed from the two shipped stylesheets and nothing
// else. Phase 15 (Breakpoint Parity) fetches those files at runtime, parses the
// 375px blocks and compares them against this table, so drift shows up as a
// failing row rather than as a quiet difference nobody notices.
//
//   site → citerate/src/styles/07-responsive/_responsive.scss
//   app  → citerate-app/src/styles/07-responsive/_responsive.scss
//
// Desktop values come from the token files and are not checked here.
(function () {
  if (window.CiterateBreakpoints) return;

  // key: [phone, desktop, checkedAgainst]
  // checkedAgainst is the custom property or declaration in the 375px block.
  var SITE = {
    gut:        ["14px", "24px", "--gutter"],
    vHero:      ["28px", "44px", ".t-hero font-size"],
    vHeroLh:    ["1.14", "1.06", ".t-hero line-height"],
    vH1:        ["25px", "34px", "--t-d2"],
    vH1Lh:      ["1.2", "1.15", "--t-d2"],
    vD3:        ["21px", "26px", "--t-d3"],
    vD4:        ["17px", "20px", null],
    vNum:       ["36px", "48px", "--t-data-xl"],
    vProse:     ["16px", "17px", ".prose font-size"],
    vCardPad:   ["16px", "32px", ".c-card padding[1]"],
    vPad:       ["16px", "32px", null],
    vOtpW:      ["44px", "48px", null],
    vOtpH:      ["50px", "56px", null],
    vOtpGap:    ["5px", "8px", null],
    vBtnW:      ["100%", "auto", "599:.scan-form__btn width"],
    vFormDir:   ["column", "row", "599:.scan-form flex-direction"],
    vRowDir:    ["column", "row", "599:.scan-form flex-direction"],
    stageMax:   ["375px", "1180px", null],
    stageRadius:["18px", "12px", null],
  };

  var APP = {
    gut:        ["14px", "24px", "--gutter"],
    vHero:      ["28px", "44px", null],
    vHeroLh:    ["1.14", "1.06", null],
    vH1:        ["25px", "34px", "--t-d2"],
    vH1Lh:      ["1.2", "1.15", "--t-d2"],
    vD3:        ["20px", "26px", "--t-d3"],
    vD4:        ["17px", "20px", "--t-d4"],
    vNum:       ["38px", "48px", "--t-data-xl"],
    vProse:     ["16px", "17px", null],
    vCardPad:   ["16px", "32px", ".auth__card padding"],
    vPad:       ["16px", "32px", ".well padding[0]"],
    vOtpW:      ["44px", "48px", ".otp input max-width"],
    vOtpH:      ["50px", "56px", ".otp input height"],
    vOtpGap:    ["5px", "8px", ".otp gap"],
    vBtnW:      ["100%", "auto", ".fix__actions width"],
    vFormDir:   ["column", "row", "599:.scan-form flex-direction"],
    vRowDir:    ["column", "row", "599:.scan-form flex-direction"],
    stageMax:   ["375px", "1240px", null],
    stageRadius:["18px", "12px", null],
  };

  var TABLES = { site: SITE, app: APP };

  window.CiterateBreakpoints = {
    tables: TABLES,
    files: {
      site: "citerate/src/styles/07-responsive/_responsive.scss",
      app: "citerate-app/src/styles/07-responsive/_responsive.scss",
    },
    // Token files, so a shipped value written as var(--s-4) can be resolved.
    tokens: {
      site: "citerate/src/styles/01-settings/_tokens.scss",
      app: "citerate-app/src/styles/01-settings/_tokens.scss",
    },
    // Flat map of the prototype's own value names, for renderVals().
    protoVars: function (repo, isPhone) {
      var t = TABLES[repo] || SITE, out = {};
      Object.keys(t).forEach(function (k) { out[k] = isPhone ? t[k][0] : t[k][1]; });
      return out;
    },
  };
})();
