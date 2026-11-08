// Zips only the files the extension needs (no backend, tests or demo pages)
// into dist/jobguard.zip, ready for the Chrome Web Store after the hackathon.
import { execFileSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";

const include = ["manifest.json", "config.js", "background", "content", "rules", "popup", "onboarding", "icons"];
mkdirSync("dist", { recursive: true });
rmSync("dist/jobguard.zip", { force: true });
execFileSync("zip", ["-r", "-q", "dist/jobguard.zip", ...include], { stdio: "inherit" });
console.log("Created dist/jobguard.zip");
console.log("Before publishing: set API_URL in config.js to your deployed backend and remove the localhost entry from manifest.json.");
