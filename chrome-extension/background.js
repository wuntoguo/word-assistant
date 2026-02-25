const APP_URL = 'https://feedlingo.fly.dev';

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: 'feedlingo-lookup',
    title: 'Look up "%s" in FeedLingo',
    contexts: ['selection'],
  });
});

chrome.contextMenus.onClicked.addListener((info) => {
  if (info.menuItemId === 'feedlingo-lookup' && info.selectionText) {
    const word = info.selectionText.trim().split(/\s+/)[0];
    const url = `${APP_URL}/#/learn?word=${encodeURIComponent(word)}`;
    chrome.tabs.create({ url });
  }
});
