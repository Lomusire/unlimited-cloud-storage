let isRunning = false;
let logs = [];
let teraboxSubdomain = ''; // Store the subdomain

function addLog(message) {
    const timestamp = new Date().toISOString();
    logs.push(`[${timestamp}] ${message}`);
    if (logs.length > 100) {
        logs.shift(); // Remove oldest log if we have more than 100
    }
    chrome.runtime.sendMessage({action: 'logUpdated'}).catch(console.error);
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isRunning: false }).catch(console.error);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'startCollecting':
            if (!isRunning) {
                isRunning = true;
                addLog('Started coin collection process');
                checkRedirect().then((subdomain) => {
                    teraboxSubdomain = subdomain;
                    collectCoins(); // Start the first collection immediately
                });
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, message: 'Already running' });
            }
            break;
        case 'stopCollecting':
            isRunning = false;
            addLog('Stopped coin collection process');
            sendResponse({ success: true });
            break;
        case 'getStatus':
            sendResponse({ isRunning: isRunning });
            break;
        case 'getLogs':
            sendResponse(logs);
            break;
        case 'getUserInfoAndCoinCount':
            getUserInfoAndCoinCount()
                .then(data => sendResponse(data))
                .catch(error => sendResponse({error: error.message}));
            return true; // Indicates that the response is asynchronous
    }
    return true;
});

async function checkRedirect() {
    try {
        const cookies = await chrome.cookies.getAll({domain: "terabox.com"});
        const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

        const response = await fetch('https://www.terabox.com', { 
            method: 'GET',
            redirect: 'follow', // Allow redirects
            credentials: 'include',
            headers: {
                'Cookie': cookieString
            }
        });
        
        const finalUrl = response.url;
        const url = new URL(finalUrl);
        teraboxSubdomain = url.hostname.split('.')[0];
        addLog(`Redirected to: ${finalUrl}`);
        addLog(`Using subdomain: ${teraboxSubdomain}`);

        return teraboxSubdomain;
    } catch (error) {
        addLog(`Error checking redirect: ${error.message}`);
        return ''; // Return empty string in case of error
    }
}

async function collectCoins() {
    while (isRunning) {
        try {
            addLog('Starting a coin collection cycle...');
            
            await delay(1000); // 1 second delay before starting the game
            
            const startData = await fetchWithRetry(getTeraboxUrl('/rest/1.0/imact/miner/start'));
            addLog(`Start game response data: ${JSON.stringify(startData)}`);
            
            if (startData.errno !== 0) {
                if (startData.errno === 28135 && startData.errmsg === 'gold miner up to limit today') {
                    isRunning = false;
                    addLog('Daily limit reached. Stopping collection.');
                    chrome.runtime.sendMessage({action: 'dailyLimitReached'}).catch(console.error);
                    return;
                }
                throw new Error(`Failed to start the game. Error code: ${startData.errno}, Message: ${startData.errmsg || 'Unknown error'}`);
            }

            const { game_id: gameId, map_info: { items } } = startData.data;
            const objectTypes = items.map(item => item.object_type);

            await Promise.all(objectTypes.map(async (objectType) => {
                if (!isRunning) return;
                const reportId = generateReportId();
                const url = getTeraboxUrl(`/rest/1.0/imact/miner/getitem?game_id=${gameId}&object_type=${objectType}&report_id=${reportId}`);
                const getItemData = await fetchWithRetry(url);
                addLog(`Get item response for object type ${objectType}: ${JSON.stringify(getItemData)}`);
                await delay(200); // Short delay between item requests
            }));

            if (!isRunning) return;

            addLog('Waiting 2 seconds before finishing the game...');
            await delay(2000);

            addLog('Finishing game...');
            const finishData = await fetchWithRetry(getTeraboxUrl(`/rest/1.0/imact/miner/finishgame?game_id=${gameId}`));
            addLog(`Finish game response: ${JSON.stringify(finishData)}`);

            addLog('Coin collection cycle completed');
            
            chrome.runtime.sendMessage({ action: 'updateCoinCount' }).catch(console.error);

        } catch (error) {
            addLog(`Error during coin collection cycle: ${error.message}`);
            await delay(5000); // Wait for 5 seconds before retrying if there's an error
        }
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

function generateReportId() {
    return Array(16).fill(0).map(() => Math.floor(Math.random() * 10)).join('');
}

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        const cookies = await chrome.cookies.getAll({domain: "terabox.com"});
        const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

        const response = await fetch(url, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'Cookie': cookieString
            },
            ...options
        });
        return await response.json();
    } catch (error) {
        if (retries > 0) {
            await delay(1000);
            return fetchWithRetry(url, options, retries - 1);
        }
        throw error;
    }
}

function getTeraboxUrl(path) {
    return `https://${teraboxSubdomain || 'www'}.terabox.com${path}`;
}

async function getUserInfoAndCoinCount() {
    try {
        const userInfoUrl = getTeraboxUrl('/passport/get_info');
        const userInfoResponse = await fetchWithRetry(userInfoUrl);
        
        const coinCountUrl = getTeraboxUrl('/rest/1.0/inte/system/getrecord');
        const coinCountResponse = await fetchWithRetry(coinCountUrl);
        
        return {
            userInfo: userInfoResponse,
            coinCount: coinCountResponse
        };
    } catch (error) {
        addLog(`Error fetching user info and coin count: ${error.message}`);
        throw error;
    }
}