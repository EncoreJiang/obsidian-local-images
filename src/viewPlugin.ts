import { Extension } from '@codemirror/state';
import { DecorationSet, EditorView, ViewPlugin, ViewUpdate } from '@codemirror/view';
import OzanImagePlugin from 'src/main';
import { editorLivePreviewField, editorViewField, TFile } from 'obsidian';
import { nextTick } from 'process';
// --> View Plugin
export const getViewPlugin = (params: { plugin: OzanImagePlugin }): Extension => {
    const { plugin } = params;

    const imageViewPlugin = ViewPlugin.fromClass(
        class {
            constructor(view: EditorView) {
                this.updateAsyncDecorations(view);
            }

            update(update: ViewUpdate) {
                console.log(update.docChanged, update.viewportChanged)
                if ((update.docChanged || update.viewportChanged)) {
                    this.updateAsyncDecorations(update.view);
                }
            }

            updateAsyncDecorations(view: EditorView) {
                const mdView = view.state.field(editorViewField);
                const sourceFile: TFile = mdView.file;
                if (view.state.field(editorLivePreviewField)) {
                    const element = mdView.contentEl

                    nextTick(() => {

                        const embeds = element.querySelectorAll("div.internal-embed");
                        console.log("-------------", element.innerHTML)

                        for (let index = 0; index < embeds.length; index++) {
                            const embed = embeds.item(index);
                            console.log(embed);
                            const src = embed.getAttr('src');
                            if (src) {
                                if (src.startsWith('.attachments/')) {
                                    embed.className = "internal-embed image-embed is-loaded";
                                    const image = element.createEl('img');
                                    // this.app.vault.getResourcePath(this.app.vault.getAbstractFileByPath(context.sourcePath)[0])
                                    const href = window.require("url").pathToFileURL(
                                        path.join((plugin.app.vault.adapter as any)['basePath'], sourceFile.parent.path, src)).href;
                                    console.log("getAbstractFileByPath", href);
                                    image.src = "app://local/" + href.replace("file:///", "");
                                    embed.innerHTML = '';
                                    embed.appendChild(image);
                                    // image.addEventListener("click", (event) => {event.stopPropagation(); }), true;
                                }
                            }
                            // const codeblock = codeblocks.item(index);
                            // const text = codeblock.innerText.trim();
                            // const isEmoji = text[0] === ":" && text[text.length - 1] === ":";

                            // if (isEmoji) {
                            //     context.addChild(new Emoji(codeblock, text));
                            // }
                        }
                    })
                }
            }

            destroy() { }
        }
    );

    return imageViewPlugin;
};

// --> Export Build Extension
export const buildExtension = (params: { plugin: OzanImagePlugin }) => {
    const { plugin } = params;
    const viewPlugin = getViewPlugin({ plugin });
    return viewPlugin;
    // return [viewPlugin, statefulDecorations.field];
};
