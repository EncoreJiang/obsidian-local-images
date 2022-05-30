import {
  App,
  Editor,
  loadMathJax,
  loadMermaid,
  MarkdownView,
  Notice,
  OpenViewState,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
} from "obsidian";
import safeRegex from "safe-regex";

import { chooseFileName, imageTagProcessor } from "./contentProcessor";
import { replaceAsync, ATTACHMENTS_CLASS, getAttachmentFolderPath, blobToArrayBuffer, ATTACHMENTS_FILE_CLASS, encodePath } from "./utils";
import {
  ISettings,
  DEFAULT_SETTINGS,
  EXTERNAL_MEDIA_LINK_PATTERN,
  ANY_URL_PATTERN,
  NOTICE_TIMEOUT,
  TIMEOUT_LIKE_INFINITY,
} from "./config";
import { UniqueQueue } from "./uniqueQueue";
import path from "path";
import { buildExtension } from "./viewPlugin";


export default class LocalImagesPlugin extends Plugin {
  settings: ISettings;
  modifiedQueue = new UniqueQueue<TFile>();
  intervalId: number = null;

  private async proccessPage(file: TFile, silent = false) {
    // const content = await this.app.vault.read(file);
    const content = await this.app.vault.cachedRead(file);

    const cleanedContent = content;
    const fixedContent = await replaceAsync(
      file,
      cleanedContent,
      EXTERNAL_MEDIA_LINK_PATTERN,
      imageTagProcessor(this.app)
    );

    if (content != fixedContent) {
      this.modifiedQueue.remove(file);
      await this.app.vault.modify(file, fixedContent);

      if (!silent && this.settings.showNotifications) {
        new Notice(`Images for "${file.path}" were processed.`);
      }
    } else {
      if (!silent && this.settings.showNotifications) {
        new Notice(
          `Page "${file.path}" has been processed, but nothing was changed.`
        );
      }
    }
  }


  // using arrow syntax for callbacks to correctly pass this context
  processActivePage = async () => {
    const activeFile = this.app.workspace.getActiveFile();
    await this.proccessPage(activeFile);
  };

  processAllPages = async () => {
    const files = this.app.vault.getMarkdownFiles();
    const includeRegex = new RegExp(this.settings.include, "i");

    const pagesCount = files.length;

    const notice = this.settings.showNotifications
      ? new Notice(
        `Local Images \nStart processing. Total ${pagesCount} pages. `,
        TIMEOUT_LIKE_INFINITY
      )
      : null;

    for (const [index, file] of files.entries()) {
      if (file.path.match(includeRegex)) {
        if (notice) {
          // setMessage() is undeclared but factically existing, so ignore the TS error
          // @ ts-expect-error
          notice.setMessage(
            `Local Images: Processing \n"${file.path}" \nPage ${index} of ${pagesCount}`
          );
        }
        await this.proccessPage(file, true);
      }
    }
    if (notice) {
      // @ ts-expect-error
      notice.setMessage(`Local Images: ${pagesCount} pages were processed.`);

      setTimeout(() => {
        notice.hide();
      }, NOTICE_TIMEOUT);
    }
  };


  openLinkTextFn: (linktext: string, sourcePath: string, newLeaf?: boolean, openViewState?: OpenViewState) => Promise<void>;;

  async onload() {
    await this.loadSettings();

    // try {
    //   loadMathJax();
    //   loadMermaid();
    // } catch (err) {
    //   console.log(err);
    // }

    this.openLinkTextFn = this.app.workspace.openLinkText;
    const openLinkTextFn = this.openLinkTextFn;
    this.app.workspace.openLinkText = function (linktext: string, sourcePath: string, newLeaf?: boolean) {
      const attachmentFolder = getAttachmentFolderPath(sourcePath);
      if (linktext.startsWith(attachmentFolder.name)) {
        return;
      }
      return openLinkTextFn.call(this, ...arguments)
    };

    const extension = buildExtension({ plugin: this });
    this.registerEditorExtension([extension]);

    this.registerEvent(this.app.workspace.on('editor-paste', this.handlePaste.bind(this)));
    this.registerEvent(this.app.workspace.on('editor-drop', this.handleDrop.bind(this)));

    this.app.vault.on("rename", async function (file, oldname) {
      if (file instanceof TFile) {
        console.log("rename:", oldname, "->", file.path);
        const oldAttachmentFolder = getAttachmentFolderPath(oldname);
        console.log(oldAttachmentFolder.fullPath)
        if (await file.vault.adapter.exists(oldAttachmentFolder.fullPath)) {
          const newAttachmentFolder = getAttachmentFolderPath(file.path);
          console.log(newAttachmentFolder.fullPath)
          try {
            await file.vault.adapter.rename(oldAttachmentFolder.fullPath,
              newAttachmentFolder.fullPath)
          } catch (ex) {
            const errMsg = `rename ${oldAttachmentFolder.fullPath} to ${newAttachmentFolder.fullPath} failed: ${ex}`;
            new Notice(errMsg);
            console.error(errMsg)
            return;
          }
          let content = await file.vault.cachedRead(file);
          const linkPrefix = encodePath(oldAttachmentFolder.name)
          const newLinkPrefix = encodePath(newAttachmentFolder.name)
          let replaceCount = 0;
          content = content.replace(
            /\!\[(?<anchor>.*?)\]\((?<dir>[^\/\)]*)(?<link>.+?)\)/g,
            (match: string, anchor: string, dir: string, link: string) => {
              if (dir == linkPrefix) {
                replaceCount++;
                return `![${anchor}](${newLinkPrefix}${link})`
              }
              return match;
            })

          content = content.replace(
            /\!\[\[(?<dir>[^\/\)]*)(?<link>.+?)\]\]/g,
            (match: string, dir: string, link: string) => {
              console.log('dir:', dir);
              console.log('link:', link);
              if (dir == linkPrefix) {
                console.log(`![[${newLinkPrefix}${link}]]`)
                replaceCount++;
                return `![[${newLinkPrefix}${link}]]`
              }
              return match;
            })
          if (replaceCount) {
            await file.vault.modify(file, content);
          }
        }
      }
    })

    this.addCommand({
      id: "download-images",
      name: "Download images locally",
      callback: this.processActivePage,
    });

    this.addCommand({
      id: "download-images-all",
      name: "Download images locally for all your notes",
      callback: this.processAllPages,
    });

    this.registerCodeMirror((cm: CodeMirror.Editor) => {
      // on("beforeChange") can not execute async function in event handler, so we use queue to pass modified pages to timeouted handler
      cm.on("change", async (instance: CodeMirror.Editor, changeObj: any) => {
        if (
          changeObj.origin == "paste" &&
          ANY_URL_PATTERN.test(changeObj.text)
        ) {
          this.onUpdate();
        }
      });
    });

    this.setupQueueInterval();

    this.addSettingTab(new SettingTab(this.app, this));


    this.registerMarkdownPostProcessor((element, context) => {
      let attachmentFolder = getAttachmentFolderPath(context.sourcePath);
      {
        const embeds = element.querySelectorAll("div.internal-embed");
        const attachmentDir = attachmentFolder.name

        for (let index = 0; index < embeds.length; index++) {
          const embed = embeds.item(index);
          console.log(embed);
          const src = embed.getAttr('src');
          if (src && embed.className !== ATTACHMENTS_CLASS) {
            if (src.startsWith(attachmentDir)) {
              embed.className = ATTACHMENTS_CLASS;
              const image = element.createEl('img');
              // this.app.vault.getResourcePath(this.app.vault.getAbstractFileByPath(context.sourcePath)[0])
              const parentPath = this.app.vault.getAbstractFileByPath(context.sourcePath).parent.path;
              const href = window.require("url").pathToFileURL(
                path.join((this.app.vault.adapter as any)['basePath'], parentPath, src)).href;
              console.log("getAbstractFileByPath", href);
              image.src = "app://local/" + href.replace("file:///", "");
              embed.appendChild(image);
            }
          }
        }
      }
      {
        const embeds = element.querySelectorAll("span.internal-embed");
        const attachmentDir = attachmentFolder.name

        for (let index = 0; index < embeds.length; index++) {
          const embed = embeds.item(index);
          console.log(embed);
          const src = embed.getAttr('src');
          if (src && embed.className !== ATTACHMENTS_FILE_CLASS) {
            if (src.startsWith(attachmentDir)) {
              embed.className = ATTACHMENTS_FILE_CLASS;
              embed.innerHTML = `<div class="file-embed-title">
              <span class="file-embed-icon">
                <svg viewBox="0 0 100 100" class="document" width="22" height="22">
                  <path fill="currentColor" stroke="currentColor" d="M14,4v92h72V29.2l-0.6-0.6l-24-24L60.8,4L14,4z M18,8h40v24h24v60H18L18,8z M62,10.9L79.1,28H62V10.9z"></path>
                </svg>
              </span> 
              ${path.basename(src)}
              </div>`
            }
            const that = this;
            const fileFullPath = path.join(path.dirname(context.sourcePath), decodeURI(src));
            embed.addEventListener('click', (event) => {
              console.log(fileFullPath);
              that.app.openWithDefaultApp(fileFullPath);
              event.stopPropagation();
            }, true);
          }
        }
      }
    });
  }

  setupQueueInterval() {
    if (this.intervalId) {
      const intervalId = this.intervalId;
      this.intervalId = null;
      window.clearInterval(intervalId);
    }
    if (
      this.settings.realTimeUpdate &&
      this.settings.realTimeUpdateInterval > 0
    ) {
      this.intervalId = window.setInterval(
        this.processModifiedQueue,
        this.settings.realTimeUpdateInterval
      );
      this.registerInterval(this.intervalId);
    }
  }

  processModifiedQueue = async () => {
    const iteration = this.modifiedQueue.iterationQueue();
    for (const page of iteration) {
      this.proccessPage(page);
    }
  };

  enqueueActivePage() {
    const activeFile = this.app.workspace.getActiveFile();
    this.modifiedQueue.push(
      activeFile,
      this.settings.realTimeAttemptsToProcess
    );
  }
  // It is good idea to create the plugin more verbose
  displayError(error: Error | string, file?: TFile): void {
    if (file) {
      new Notice(
        `LocalImages: Error while handling file ${file.name
        }, ${error.toString()}`
      );
    } else {
      new Notice(error.toString());
    }

    console.error(`LocalImages: error: ${error}`);
  }

  onunload() {
    this.app.workspace.openLinkText = this.openLinkTextFn;
  }

  onUpdate() {
    if (this.settings.realTimeUpdate) {
      this.enqueueActivePage();
    }
  }

  async handlePaste(event: ClipboardEvent, editor: Editor, view: MarkdownView) {
    console.log('Handle Paste');

    let clipBoardData = event.clipboardData;
    let clipBoardItems = clipBoardData.items;
    let textData = clipBoardData.getData('text/plain');

    if (textData) {
      this.onUpdate();
    } else {
      event.preventDefault();
      for (let i in clipBoardItems) {
        if (!clipBoardItems.hasOwnProperty(i))
          continue;
        let item = clipBoardItems[i];
        const mdCode = await this.processDataTransferItem(editor, view, item);
        if (mdCode) {
          editor.replaceSelection(mdCode);
        }
      }
    }
  }

  async handleDrop(event: DragEvent, editor: Editor, view: MarkdownView) {
    console.log('Handle Drop');

    if (event.dataTransfer) {
      event.preventDefault();
      for (let i in event.dataTransfer.items) {
        if (!event.dataTransfer.items.hasOwnProperty(i))
          continue;
        let item = event.dataTransfer.items[i];
        const mdCode = await this.processDataTransferItem(editor, view, item);
        if (mdCode) {
          editor.replaceSelection(mdCode);
        }
      }
    }
  }

  async processDataTransferItem(editor: Editor, view: MarkdownView, item: DataTransferItem): Promise<string> {
    if (item.kind !== 'file')
      return null;

    const isImage = item.type.startsWith("image/");

    let file = item.getAsFile();
    if (!file)
      return null;

    let attachmentFolder = getAttachmentFolderPath(view.file.path);

    event.preventDefault();
    const fileData = await blobToArrayBuffer(file);
    const { fileFullPath, fileName, needWrite } = await chooseFileName(
      this.app.vault.adapter,
      attachmentFolder.fullPath,
      file.name,
      "",
      fileData
    );

    if (needWrite && fileFullPath) {
      try {
        if (!(await this.app.vault.adapter.exists(attachmentFolder.fullPath))) {
          console.log("create folder:", attachmentFolder.fullPath);

          await this.app.vault.createFolder(attachmentFolder.fullPath);
        }
      } catch (error) {
        if (!error.message.contains("Folder already exists")) {
          throw error;
        }
      }

      console.log("createBinary:", fileFullPath);

      await this.app.vault.createBinary(fileFullPath, fileData);
    }

    if (isImage) {
      return `![${fileName}](${encodePath(path.join(attachmentFolder.name, fileName))})`;
    } else {
      return `![[${encodePath(path.join(attachmentFolder.name, fileName))}]]`;
    }
  }

  updateAttachmentFolderConfig(path: string) {
    //@ts-ignore
    this.app.vault.setConfig('attachmentFolderPath', path);
  }

  async loadSettings() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    this.setupQueueInterval();
  }

  async saveSettings() {
    try {
      await this.saveData(this.settings);
    } catch (error) {
      this.displayError(error);
    }
  }

  async ensureFolderExists(folderPath: string) {
    try {
      await this.app.vault.createFolder(folderPath);
    } catch (error) {
      if (!error.message.contains("Folder already exists")) {
        throw error;
      }
    }
  }
}

class SettingTab extends PluginSettingTab {
  plugin: LocalImagesPlugin;

  constructor(app: App, plugin: LocalImagesPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    let { containerEl } = this;

    containerEl.empty();

    containerEl.createEl("h2", { text: "Local images" });

    new Setting(containerEl)
      .setName("On paste processing")
      .setDesc("Process active page if external link was pasted.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.realTimeUpdate)
          .onChange(async (value) => {
            this.plugin.settings.realTimeUpdate = value;
            await this.plugin.saveSettings();
            this.plugin.setupQueueInterval();
          })
      );

    new Setting(containerEl)
      .setName("On paste processing interval")
      .setDesc("Interval in milliseconds for processing update.")
      .setTooltip(
        "I could not process content on the fly when it is pasted. So real processing implements periodically with the given here timeout."
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.realTimeUpdateInterval))
          .onChange(async (value: string) => {
            const numberValue = Number(value);
            if (
              isNaN(numberValue) ||
              !Number.isInteger(numberValue) ||
              numberValue < 0
            ) {
              this.plugin.displayError(
                "Realtime processing interval should be a positive integer number!"
              );
              return;
            }
            this.plugin.settings.realTimeUpdateInterval = numberValue;
            await this.plugin.saveSettings();
            this.plugin.setupQueueInterval();
          })
      );

    new Setting(containerEl)
      .setName("Attempts to process")
      .setDesc(
        "Number of attempts to process content on paste. For me 3 attempts is enouth with 1 second update interval."
      )
      .setTooltip(
        "I could not find the way to access newly pasted content immediatily, after pasting, Plugin's API returns old text for a while. The workaround is to process page several times until content is changed."
      )
      .addText((text) =>
        text
          .setValue(String(this.plugin.settings.realTimeAttemptsToProcess))
          .onChange(async (value: string) => {
            const numberValue = Number(value);
            if (
              isNaN(numberValue) ||
              !Number.isInteger(numberValue) ||
              numberValue < 1 ||
              numberValue > 100
            ) {
              this.plugin.displayError(
                "Realtime processing interval should be a positive integer number greater than 1 and lower than 100!"
              );
              return;
            }
            this.plugin.settings.realTimeAttemptsToProcess = numberValue;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Show notifications")
      .setDesc("Show notifications when pages were processed.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNotifications)
          .onChange(async (value) => {
            this.plugin.settings.showNotifications = value;
            await this.plugin.saveSettings();
          })
      );

    new Setting(containerEl)
      .setName("Include")
      .setDesc(
        "Include only files matching this regex pattern when running on all notes."
      )
      .addText((text) =>
        text.setValue(this.plugin.settings.include).onChange(async (value) => {
          if (!safeRegex(value)) {
            this.plugin.displayError(
              "Unsafe regex! https://www.npmjs.com/package/safe-regex"
            );
            return;
          }
          this.plugin.settings.include = value;
          await this.plugin.saveSettings();
        })
      );
  }
}
