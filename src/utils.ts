import path from "path";
import got from "got";
import { fromBuffer } from "file-type";
import isSvg from "is-svg";
import filenamify from "filenamify";

import { DIRTY_IMAGE_TAG, FORBIDDEN_SYMBOLS_FILENAME_PATTERN } from "./config";
import { TFile } from "obsidian";

export const ATTACHMENTS_CLASS = "internal-embed image-embed is-loaded attachments";

export const ATTACHMENTS_FILE_CLASS = "internal-embed file-embed is-loaded attachments";
/*
https://stackoverflow.com/a/48032528/1020973
It will be better to do it type-correct.

*/
export async function replaceAsync(file: TFile, str: any, regex: any, asyncFn: any) {
  const promises: Promise<any>[] = [];
  str.replace(regex, (match: string, ...args: any) => {
    const promise = asyncFn(file, match, ...args);
    promises.push(promise);
  });
  const data = await Promise.all(promises);
  return str.replace(regex, () => data.shift());
}

export function isUrl(link: string) {
  try {
    return Boolean(new URL(link));
  } catch (_) {
    return false;
  }
}

export async function downloadImage(url: string): Promise<ArrayBuffer> {
  const res = await got(url, { responseType: "buffer" });
  return res.body;
}

export async function fileExtByContent(content: ArrayBuffer) {
  const fileExt = (await fromBuffer(content))?.ext;
  // if XML, probably it is SVG
  if (!fileExt || fileExt == "xml") {
    const buffer = Buffer.from(content);
    if (isSvg(buffer)) return "svg";
  }

  return fileExt;
}

function recreateImageTag(match: string, anchor: string, link: string) {
  return `![${anchor}](${link})`;
}

export function cleanContent(content: string) {
  const cleanedContent = content.replace(DIRTY_IMAGE_TAG, recreateImageTag);
  return cleanedContent;
}

export function cleanFileName(name: string) {
  const cleanedName = filenamify(name).replace(
    FORBIDDEN_SYMBOLS_FILENAME_PATTERN,
    "_"
  );
  return cleanedName;
}

export function pathJoin(dir: string, subpath: string): string {
  const result = path.join(dir, subpath);
  // it seems that obsidian do not understand paths with backslashes in Windows, so turn them into forward slashes
  return result.replace(/\\/g, "/");
}


export function getAttachmentFolderPath(mdPath: string): {
  name: string,
  fullPath: string,
} {
  const dir = path.dirname(mdPath);
  let filename = path.basename(mdPath);
  if (filename.endsWith(".md")) {
    filename = filename.slice(0, filename.length - 3);
  }
  let name = `.${filename}.attachments`;
  let fullPath = path.join(dir, name)
  return {
    name,
    fullPath,
  }
}


export async function blobToArrayBuffer(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onloadend = () => resolve(reader.result as ArrayBuffer)
    reader.readAsArrayBuffer(blob)
  })
}

export function encodePath(str: string) {
  var ret = '';
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c >= 0x3400 && c <= 0x9fa5) {
      ret += str[i];
    }
    else {
      ret += encodeURI(String.fromCharCode(c));
    }
  }
  return ret;
};