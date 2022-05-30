import { URL } from "url";
import path from "path";

import { App, DataAdapter, TFile } from "obsidian";

import {
  isUrl,
  downloadImage,
  fileExtByContent,
  cleanFileName,
  pathJoin,
  encodePath,
} from "./utils";
import {
  FILENAME_TEMPLATE,
  MAX_FILENAME_INDEX,
  FILENAME_ATTEMPTS,
} from "./config";
import { linkHashes } from "./linksHash";

export function imageTagProcessor(app: App) {
  async function processImageTag(file: TFile, match: string, anchor: string, link: string) {
    if (!isUrl(link)) {
      return match;
    }

    const cwd = file.parent.path;
    let baseName = file.basename;
    if (baseName.endsWith('.md')) {
      baseName = baseName.slice(0, baseName.length - 3)
    }
    let attachmentDir = `.${baseName}.attachments`

    const mediaDir = path.join(file.parent.path, attachmentDir);


    try {
      const fileData = await downloadImage(link);

      // when several images refer to the same file they can be partly
      // failed to download because file already exists, so try to resuggest filename several times
      let attempt = 0;
      while (attempt < FILENAME_ATTEMPTS) {
        try {
          const { fileFullPath, fileName, needWrite } = await chooseFileName(
            app.vault.adapter,
            mediaDir,
            anchor,
            link,
            fileData
          );

          if (needWrite && fileFullPath) {

            try {
              await file.vault.createFolder(mediaDir);
            } catch (error) {
              if (!error.message.contains("Folder already exists")) {
                throw error;
              }
            }

            await app.vault.createBinary(fileFullPath, fileData);
          }

          if (fileFullPath) {
            return `![${anchor}](${encodePath((pathJoin(attachmentDir, fileName)))})`;
          } else {
            return match;
          }
        } catch (error) {
          if (error.message === "File already exists.") {
            attempt++;
          } else {
            throw error;
          }
        }
      }
      return match;
    } catch (error) {
      console.warn("Image processing failed: ", error);
      return match;
    }
  }

  return processImageTag;
}

export async function chooseFileName(
  adapter: DataAdapter,
  dir: string,
  baseName: string,
  link: string,
  contentData: ArrayBuffer
): Promise<{ fileFullPath: string; fileName: string; needWrite: boolean }> {
  const fileExt = await fileExtByContent(contentData);

  if (!fileExt) {
    return { fileFullPath: "", fileName: "", needWrite: false };
  }
  // if there is no anchor try get file name from url
  if (!baseName) {
    const parsedUrl = new URL(link);

    baseName = path.basename(parsedUrl.pathname);
  }
  // if there is no part for file name from url use name template
  if (!baseName) {
    baseName = FILENAME_TEMPLATE;
  }

  // if filename already ends with correct extension, remove it to work with base name
  if (baseName.endsWith(`.${fileExt}`)) {
    baseName = baseName.slice(0, -1 * (fileExt.length + 1));
  }

  baseName = cleanFileName(baseName);

  let fileName = "";
  let fileFullPath = "";
  let needWrite = true;
  let index = 0;
  while (!fileFullPath && index < MAX_FILENAME_INDEX) {
    const suggestedName = index
      ? `${baseName}-${index}.${fileExt}`
      : `${baseName}.${fileExt}`;
    const suggestedFullPath = pathJoin(dir, suggestedName);

    if (await adapter.exists(suggestedFullPath, false)) {
      linkHashes.ensureHashGenerated(link, contentData);

      const fileData = await adapter.readBinary(suggestedFullPath);

      if (linkHashes.isSame(link, fileData)) {
        fileFullPath = suggestedFullPath;
        fileName = suggestedName;
        needWrite = false;
      }
    } else {
      fileFullPath = suggestedFullPath;
      fileName = suggestedName;
    }

    index++;
  }
  if (!fileFullPath) {
    throw new Error("Failed to generate file name for media file.");
  }

  linkHashes.ensureHashGenerated(link, contentData);

  return { fileFullPath, fileName, needWrite };
}
