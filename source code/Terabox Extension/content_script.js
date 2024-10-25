chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'updateEmbeddedContent') {
      updateEmbeddedContent(request.content);
    }
  });
  
  function updateEmbeddedContent(content) {
    const parser = new DOMParser();
    const doc = parser.parseFromString(content, 'text/html');
  
    // Remove scripts to prevent execution
    doc.querySelectorAll('script').forEach(script => script.remove());
  
    // Create a new style element and append all existing styles
    const style = document.createElement('style');
    doc.querySelectorAll('style, link[rel="stylesheet"]').forEach(s => {
      if (s.tagName === 'STYLE') {
        style.textContent += s.textContent;
      } else if (s.tagName === 'LINK') {
        style.textContent += `@import url('${s.href}');`;
      }
    });
  
    // Clear the content and append the new style and body content
    document.body.innerHTML = '';
    document.body.appendChild(style);
    document.body.appendChild(doc.body);
  
    // Add event listeners for buttons or forms
    addRedeemEventListeners(document.body);
  }
  
  function addRedeemEventListeners(container) {
    container.querySelectorAll('form').forEach(form => {
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const formData = new FormData(form);
        try {
          const response = await fetch(form.action, {
            method: form.method,
            body: formData,
            credentials: 'include'
          });
          const result = await response.json();
          if (result.errno === 0) {
            alert('Redemption successful!');
            chrome.runtime.sendMessage({action: 'updateUserInfoAndCoinCount'});
          } else {
            alert('Redemption failed: ' + result.errmsg);
          }
        } catch (error) {
          console.error('Error during redemption:', error);
          alert('An error occurred during redemption. Please try again.');
        }
      });
    });
  }