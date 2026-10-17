import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const sourceDir = path.join(__dirname, "src");
const targetDir = path.join(__dirname, "dist");

function copyFolderRecursiveSync(source: string, target: string) {
  if (!fs.existsSync(source)) {
    return;
  }
  if (!fs.existsSync(target)) {
    fs.mkdirSync(target, { recursive: true });
  }

  const files = fs.readdirSync(source);
  for (const file of files) {
    if (file === ".DS_Store") continue;
    const curSource = path.join(source, file);
    const curTarget = path.join(target, file);
    if (fs.lstatSync(curSource).isDirectory()) {
      copyFolderRecursiveSync(curSource, curTarget);
    } else {
      fs.copyFileSync(curSource, curTarget);
    }
  }
}

console.log("Building Civ VII Chat Mod...");

if (fs.existsSync(targetDir)) {
  fs.rmSync(targetDir, { recursive: true, force: true });
}
fs.mkdirSync(targetDir, { recursive: true });

copyFolderRecursiveSync(sourceDir, targetDir);

console.log("Mod successfully built and copied to ./dist!");
