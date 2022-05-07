export const FILENAME_TEMPLATE = "media";

export const MAX_FILENAME_INDEX = 1000;

export const FILENAME_ATTEMPTS = 5;

export const EXTERNAL_MEDIA_LINK_PATTERN =
  /\!\[(?<anchor>.*?)\]\((?<link>.+?)\)/g;

export const DIRTY_IMAGE_TAG = /\[\!\[\[(?<anchor>.*?)\]\]\((?<link>.+?)\)\]/g;

export const ANY_URL_PATTERN =
  /[a-zA-Z\d]+:\/\/(\w+:\w+@)?([a-zA-Z\d.-]+\.[A-Za-z]{2,4})(:\d+)?(\/.*)?/i;

// Looks like timeouts in Obsidian API are set in milliseconds
export const NOTICE_TIMEOUT = 10 * 1000;

export const TIMEOUT_LIKE_INFINITY = 24 * 60 * 60 * 1000;

export const FORBIDDEN_SYMBOLS_FILENAME_PATTERN = /\s+/g;
export interface ISettings {
  mediaServerURL: string;
  showNotifications: boolean;
}

export const DEFAULT_SETTINGS: ISettings = {
  mediaServerURL: "http://119.28.140.234:8080/im",
  showNotifications: true,
};
