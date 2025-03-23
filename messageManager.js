// -----------------------
//     messageManager.js
//     ver 2.2.1
// -----------------------


function getMessage(key) {
  const lang = localStorage.getItem('language') || 'en';
  if (window.messages && window.messages[lang] && window.messages[lang][key]) {
    return window.messages[lang][key];
  }
  return key;
}

// Expose getMessage() 
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getMessage };
} else {
  window.getMessage = getMessage;
}
