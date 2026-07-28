"use strict";

const fs = require("fs");
const path = require("path");
const sharp = require("sharp");
const toIco = require("to-ico");

const root = path.join(__dirname, "..");
const sourcePath = path.join(root, "assets", "app-icon.svg");
const pngPath = path.join(root, "assets", "app-icon.png");
const icoPath = path.join(root, "assets", "app-icon.ico");
const sizes = [16, 24, 32, 48, 64, 128, 256];

async function main() {
  const source = fs.readFileSync(sourcePath);
  await sharp(source, { density: 192 })
    .resize(760, 760, { fit: "contain" })
    .png()
    .toFile(pngPath);

  const frames = await Promise.all(sizes.map((size) =>
    sharp(source, { density: 192 })
      .resize(size, size, { fit: "contain" })
      .png()
      .toBuffer()
  ));
  fs.writeFileSync(icoPath, await toIco(frames));
  console.log(`Built ${path.relative(root, pngPath)} and ${path.relative(root, icoPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});