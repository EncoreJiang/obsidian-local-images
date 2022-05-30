import { Extension } from '@codemirror/state';
import { Decoration, DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import { editorLivePreviewField, editorViewField, TFile } from 'obsidian';
import { nextTick } from 'process';
import path from 'path';
import { ATTACHMENTS_CLASS, ATTACHMENTS_FILE_CLASS } from './utils';

import { StateEffect, StateEffectType, StateField } from '@codemirror/state';
import LocalImagesPlugin from 'src/main';

const reImageExt = /.(png|jpg|jpeg|bmp|gif|tif|svg)$/i;

// --> View Plugin
export function getViewPlugin(params: { plugin: LocalImagesPlugin }): Extension {
    const { plugin } = params;
    console.log("ViewPlugin.fromClass:", ViewPlugin.fromClass)

    const imageViewPlugin = ViewPlugin.fromClass(
        class {
            constructor(view: EditorView) {
                this.updateImageView(view);
            }

            update(update: ViewUpdate) {
                console.log(update.docChanged, update.viewportChanged)
                if ((update.docChanged || update.viewportChanged)) {
                    this.updateImageView(update.view);
                }
            }

            updateImageView(view: EditorView) {
                const mdView = view.state.field(editorViewField);
                const sourceFile: TFile = mdView.file;
                if (view.state.field(editorLivePreviewField)) {
                    const element = mdView.contentEl

                    nextTick(() => {

                        const embeds = element.querySelectorAll("div.internal-embed");
                        let baseName = sourceFile.basename;
                        if (baseName.endsWith('.md')) {
                            baseName = baseName.slice(0, baseName.length - 3)
                        }
                        let attachmentDir = `.${baseName}.attachments`
                        for (let index = 0; index < embeds.length; index++) {
                            const embed = embeds.item(index);
                            console.log(embed);
                            const src = embed.getAttr('src');
                            if (src && !embed.className.contains('attachments')) {
                                if (src.startsWith(attachmentDir)) {
                                    if (reImageExt.test(src)) {
                                        embed.className = ATTACHMENTS_CLASS;
                                        const image = element.createEl('img');
                                        // this.app.vault.getResourcePath(this.app.vault.getAbstractFileByPath(context.sourcePath)[0])
                                        const parentPath = sourceFile.parent.path;
                                        const href = window.require("url").pathToFileURL(
                                            path.join((plugin.app.vault.adapter as any)['basePath'], parentPath, src)).href;
                                        console.log("getAbstractFileByPath", href);
                                        image.src = "app://local/" + href.replace("file:///", "");
                                        embed.innerHTML = '';
                                        embed.appendChild(image);
                                    } else {
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
                                }
                            }

                        }
                    })
                }
            }

            destroy() { }
        }, {
        decorations: (v) => Decoration.set([])
    }
    );

    return imageViewPlugin;
};

// --> Export Build Extension
export const buildExtension = (params: { plugin: LocalImagesPlugin }) => {
    const { plugin } = params;
    const viewPlugin = getViewPlugin({ plugin });
    return viewPlugin;
};
