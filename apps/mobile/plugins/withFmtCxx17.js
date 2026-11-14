// Xcode 26 clang rejects fmt 11.0.2 consteval format strings under C++20.
// Build only the fmt pod as C++17 so Release archives compile.
const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");
const MARK = "# agentdeck-fmt-cxx17";
module.exports = function withFmtCxx17(config) {
  return withDangerousMod(config, ["ios", (cfg) => {
    const file = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
    let src = fs.readFileSync(file, "utf8");
    if (!src.includes(MARK)) {
      src = src.replace(/post_install do \|installer\|\n/, (m) => m +
`    ${MARK}
    installer.pods_project.targets.each do |t|
      next unless t.name == 'fmt'
      t.build_configurations.each { |c| c.build_settings['CLANG_CXX_LANGUAGE_STANDARD'] = 'c++17' }
    end
`);
      fs.writeFileSync(file, src);
    }
    return cfg;
  }]);
};
