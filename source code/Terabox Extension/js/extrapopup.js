const redeemPopupBtn = document.getElementById('redeem-popup-btn')
const redeemCloseBtn = document.getElementById('redeem-popup-close-btn')
const redeemPopupContainer = document.getElementById('redeem-popup-container')
const buyingItemContainer = document.getElementById('buy-items-lists')

const productTENbtn = document.getElementById('redeem-product-10')


redeemPopupBtn.addEventListener('click', () => {
    redeemPopupContainer.classList.remove('d-none')
})
redeemCloseBtn.addEventListener('click', () => {
    redeemPopupContainer.classList.add('d-none')
})

function getCheckedRadioValue() {
    const selectedRadio = document.querySelector('input[name="inlineRadioOptions"]:checked');
    return selectedRadio ? selectedRadio.value : null;
}


document.querySelectorAll('input[name="inlineRadioOptions"]').forEach(radio => {
    radio.addEventListener('change', () => {
        const currentValue = getCheckedRadioValue();
        fetchItemsTo(currentValue)
    });
});
fetchItemsTo()
async function fetchItemsTo(item_kind = 0) {
    const url = `https://www.terabox.com/rest/1.0/inte/mall/list?app_id=250528&item_kind=${item_kind}`
    const response = await fetchData(url, false)
    // console.log(response, getCheckedRadioValue());

    const parsedHtml = await response.data.group.map((val, key) => {
        return `
        <div class="accordion-item outline-none bg-transparent text-white">
            <h2 class="accordion-header text-white" id="flush-heading${key}">
                <button class="bg-transparent accordion-button shadow-none collapsed flex justify-content-between text-white" type="button" data-bs-toggle="collapse" data-bs-target="#flush-collapse${key}" aria-expanded="false" aria-controls="flush-collapse${key}">
                <span class="text-ellipsis w-50 text-nowrap">${val.title}</span> <span>${val.price}T</span>
                </button>
            </h2>
            <div id="flush-collapse${key}" class="accordion-collapse collapse px-4 text-center" aria-labelledby="flush-heading${key}" data-bs-parent="#accordionFlushExample">
            ${val.title}
                <div class="d-flex justify-content-between align-items-center " style="scale: .8;">
                    <input class="input-group w-25 px-2 buying-quantity" min="0" max="10" value="1" type="number" />
                    <button data-productId="${val.id}" class="btn btn-success w-25 buying-product-button">Buy</button>
                </div>
            </div>
        </div>
        `
    }).join('')
    buyingItemContainer.innerHTML = ''
    buyingItemContainer.innerHTML = parsedHtml;
    renderBtns()
}

function renderBtns() {
    document.querySelectorAll('.buying-product-button').forEach(e => {
        e.addEventListener('click', () => {
            const quantityInput = e.parentElement.querySelector('.buying-quantity');
            // console.log(e.dataset.productid, quantityInput.value);
            const response = purchaseProducts(e.dataset.productid, quantityInput.value)
        });
    });
};



async function purchaseProducts(item_id, item_count = 1) {
    const purchaseUrl = `https://www.terabox.com/rest/1.0/inte/mall/buy?app_id=250528&web=1&channel=dubox&clienttype=5&jsToken=C18D32261B446E9A26DBF34D86530BEB1E3598E1DCACE3CDFCEE268BE503C2AB65090EB108CB9F6DDF1392DE028605BAF5F24805690FC4881BDED78696F0B4BF&dp-logid=62316100841436900024&version=0&devuid=0&cuid=0&lang=en&item_id=${item_id}&cnt=${item_count}&mail=&paypal=&ev=other&aid=aid&ak=200007&sk=0413dd7561e0413fd1b4c398e6f04fe9&data-app=eyJhcHBfa2V5IjoiMjAwMDA3IiwiYXBwX3ZpZXciOiJwcm9tb3RlIiwiZm9ybV9kZXNjIjoiIiwic2VuZF9pbnRlcnZhbCI6NTAsInNlbmRfbWV0aG9kIjozfQ%3D%3D&item_kind=1`;
    const itemDetailsUrl = `https://www.terabox.com/rest/1.0/inte/mall/detail?item_id=${item_id}`;
    const [response, res] = await Promise.all([
        fetchData(purchaseUrl, true),
        fetchData(itemDetailsUrl, true)
    ]);
    const errorMessages = {
        29109: `Max limit exceeded. ${res.data.bought.limit_cnt}/${res.data.bought.bought_cnt}`,
        29100: 'Insufficient coins.',
        0: `Purchased successfully. Remain ${res.data.bought.limit_cnt}/${res.data.bought.bought_cnt}`
    };
    const message = errorMessages[response.errno] || 'Unknown Error.';
    const messageType = response.errno === 0 ? 'success' : 'danger';
    throwMessage(message, messageType);
}

async function getTeraboxCookies() {
    return new Promise((resolve) => {
        chrome.cookies.getAll({ domain: 'terabox.com' }, (cookies) => {
            resolve(cookies);
        });
    });
}

async function fetchData(url, includeCookies = false) {
    const options = {
        method: 'GET',
        redirect: 'follow',
        credentials: 'include',
        headers: {},
        mode: 'no-cors'
    };
    if (includeCookies) {
        const cookies = await getTeraboxCookies();
        const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');
        // console.log('Got cookies:', cookieString);
        options.headers['Cookie'] = cookieString;
    }
    try {
        const response = await fetch(url, options);
        if (!response.ok) {
            // throw new Error(`HTTP error! Status: ${response.status}`);
        }
        const responseParsed = await response.json();
        return responseParsed;
    } catch (error) {
        // console.error('Fetch failed:', error);
        // throw error; // Re-throw the error after logging it
    }
}

function throwMessage(message, alertType = 'success') {
    const messageId = `alert-${Date.now()}`;
    let messageHtml = `
        <div id="${messageId}" class="alert alert-${alertType} mb-1 alert-dismissible fade show animation-from-side" style="font-size:.8rem" role="alert">
            <span>${message}</span>
            <button type="button" class="btn-close" data-bs-dismiss="alert" aria-label="Close"></button>
        </div>
    `;
    document.getElementById('message-thrower-container').insertAdjacentHTML('beforeend', messageHtml);
    setTimeout(() => {
        const alertElement = document.getElementById(messageId);
        if (alertElement) {
            alertElement.remove();
        }
    }, 2000);
}
