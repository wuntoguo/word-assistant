const APP_URL = 'https://word-assistant.fly.dev';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'word-assistant-lookup',
    title: 'Look up "%s" in Word Assistant',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'word-assistant-lookup' && info.selectionText) {
    const word = info.selectionText.trim().split(/\s+/)[0];
    const url = `${APP_URL}/#/?word=${encodeURIComponent(word)}`;
    chrome.tabs.create({ url });
  }
});
