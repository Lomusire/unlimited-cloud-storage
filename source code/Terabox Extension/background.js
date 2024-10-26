let isRunning = false;
let logs = [];
let teraboxSubdomain = '';
let dailyLimitReached = false;
let coins = 0;

let globalLogCount = 0
function addLog(message) {
    const timestamp = new Date().toLocaleTimeString();
    globalLogCount++
    logs.push(`${globalLogCount} : [${timestamp}] ${message}`);
    if (logs.length > 100) {
        logs.shift();
    }
    chrome.runtime.sendMessage({action: 'logUpdated'}).catch(console.error);
}

chrome.runtime.onInstalled.addListener(() => {
    chrome.storage.local.set({ isRunning: false, dailyLimitReached: false }).catch(console.error);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    switch (request.action) {
        case 'startCollecting':
            if (!isRunning && !dailyLimitReached) {
                isRunning = true;
                addLog('Started coin collection process');
                checkRedirect().then((subdomain) => {
                    teraboxSubdomain = subdomain;
                    collectCoins();
                });
                sendResponse({ success: true });
            } else {
                sendResponse({ success: false, message: dailyLimitReached ? 'Daily limit reached' : 'Already running' });
            }
            break;
        case 'stopCollecting':
            isRunning = false;
            addLog('Stopped coin collection process');
            sendResponse({ success: true });
            break;
        case 'getStatus':
            sendResponse({ isRunning: isRunning, dailyLimitReached: dailyLimitReached });
            break;
        case 'getLogs':
            sendResponse(logs);
            break;
        case 'getUserInfoAndCoinCount':
            getUserInfoAndCoinCount()
                .then(data => sendResponse(data))
                .catch(error => sendResponse({error: error.message}));
            return true;
        case 'loadEmbeddedPage':
            loadEmbeddedPage(request.url, sender.tab.id);
            break;
    }
    return true;
});

async function loadEmbeddedPage(url, tabId) {
    try {
        const response = await fetch(url, { credentials: 'include' });
        const text = await response.text();
        
        chrome.tabs.sendMessage(tabId, {
            action: 'updateEmbeddedContent',
            content: text
        });
    } catch (error) {
        console.error('Error loading embedded content:', error);
        chrome.tabs.sendMessage(tabId, {
            action: 'updateEmbeddedContent',
            content: 'Error loading content. Please try again.'
        });
    }
}

chrome.declarativeNetRequest.updateDynamicRules({
    removeRuleIds: [1],
    addRules: [{
        id: 1,
        priority: 1,
        action: {
            type: 'modifyHeaders',
            responseHeaders: [
                { header: 'X-Frame-Options', operation: 'remove' },
                { header: 'Frame-Options', operation: 'remove' }
            ]
        },
        condition: {
            urlFilter: '*://*.terabox.com/*',
            resourceTypes: ['sub_frame']
        }
    }]
});

async function getTeraboxCookies() {
    return new Promise((resolve) => {
        chrome.cookies.getAll({ domain: 'terabox.com' }, (cookies) => {
            resolve(cookies);
        });
    });
}

async function checkRedirect() {
    try {
        const cookies = await getTeraboxCookies();
        const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

        const response = await fetch('https://www.terabox.com', { 
            method: 'GET',
            redirect: 'follow',
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
        return '';
    }
}

async function collectCoins() {
    while (isRunning) {
        try {
            // Get extra 80 bonus coins first
            addLog('Requesting bonus coins...');
            const bonusResponse = await fetchWithRetry(getTeraboxUrl('/rest/1.0/imact/goldrain/report?&valid_envelope_cnt=80'));
            if (bonusResponse.errno === 0) {
                addLog('Successfully collected bonus coins');
            }

            addLog('Starting a coin collection cycle...');
            
            const minerInfo = await fetchWithRetry(getTeraboxUrl('/rest/1.0/imact/miner/pull'));
            let minerData = { errno: 0, data: minerInfo.data, coins: coins };
            
            do {
                minerData = await runGame(minerData.data, minerData.coins);
            } while (minerData.errno == 0 && minerData.data.buy_times_left > 0);

            if (minerData.errno === -1) {
                addLog('Miner game completed. Starting GemMerge game...');
                await playGemMergeGame();
                
                isRunning = false;
                addLog('All games completed. Stopping collection.');
                chrome.runtime.sendMessage({action: 'noMoreGames'}).catch(console.error);
                return;
            }

            addLog('Games cycle completed');
            
            chrome.runtime.sendMessage({ action: 'updateCoinCount' }).catch(console.error);

            const nextCycleDelay = 5000 + Math.random() * 5000;
            addLog(`Waiting ${Math.round(nextCycleDelay / 1000)} seconds before next cycle...`);
            await delay(nextCycleDelay);

        } catch (error) {
            addLog(`Error during games cycle: ${error.message}`);
            await delay(10000);
        }
    }
}

async function runGame(minerInfo, coins) {
    minerInfo.buy_times_left -= 51;
    
    addLog(`Free Times Left: ${minerInfo.free_times_left}`);
    addLog(`Play Times Left: ${minerInfo.buy_times_left} (Price: ${minerInfo.price} coins)`);
    
    if (minerInfo.free_times_left > 0 || (minerInfo.buy_times_left > 0 && coins > minerInfo.price)) {
        await delay(1000);
        
        coins -= minerInfo.price;
        const minerStart = await fetchWithRetry(getTeraboxUrl('/rest/1.0/imact/miner/start'));
        if (minerStart.errno != 0) {
            addLog(`Miner Error: ${JSON.stringify(minerStart)}`);
            return { errno: minerStart.errno, data: {}, coins };
        }
        
        const rDate = Date.now();
        addLog(`Miner Start: GAME #${minerStart.data.game_id}`);
        const { game_id, map_info: { items } } = minerStart.data;
        const getItemPrefixUrl = `/rest/1.0/imact/miner/getitem?game_id=${game_id}`;
        const objectTypes = items.map(item => item.object_type);
        
        for (const objectType of objectTypes) {
            if (objectType === 0 || objectType === 10) {
                continue;
            }
            const reportId = Date.now();
            const getItemUrl = `${getItemPrefixUrl}&object_type=${objectType}&report_id=${reportId}`;
            const getItemData = await fetchWithRetry(getTeraboxUrl(getItemUrl));
            if (getItemData.errno == 0 && getItemData.data) {
                parseReward(getItemData.data?.result);
            } else {
                addLog(`Get Item ERROR: ${JSON.stringify(getItemData)}`);
            }
            await delay(2000 + Math.floor(Math.random() * 100) + 1);
        }
        
        const pausingTimer = (rDate + 60000) - Date.now();
        addLog(`Ending Game in ${pausingTimer} ms...`);
        await delay(pausingTimer);
        
        const finishGameUrl = `/rest/1.0/imact/miner/finishgame?game_id=${game_id}`;
        const minerFinish = await fetchWithRetry(getTeraboxUrl(finishGameUrl));
        if (minerFinish.errno == 0) {
            addLog('Game Ended. Results:');
            const rewards = minerFinish.data.rewards;
            for (const reward of rewards) {
                parseReward(reward);
                if (reward.reward_kind == 9) {
                    coins += reward.size;
                }
            }
            if (rewards.length == 1 && rewards[0].reward_kind == 3 && rewards[0].size == 34603008) {
                addLog('Note: No good rewards in next game, quit playing game...');
                return { errno: -1, data: {}, coins };
            }
        } else {
            addLog(`Game Results: ${minerFinish.errno} ${JSON.stringify(minerFinish.data)}`);
        }
        
        return { errno: minerFinish.errno, data: minerFinish.data, coins };
    } else {
        return { errno: -1, data: {}, coins };
    }
}

async function playGemMergeGame() {
    try {
        // Try to retrieve stored game state
        const gameState = await new Promise(resolve => {
            chrome.storage.local.get(['gemMergeState'], result => {
                resolve(result.gemMergeState || null);
            });
        });

        let gameId;
        let currentLevel;

        // Check if we have a stored game and if it's still valid
        if (gameState) {
            addLog('Attempting to resume previous game session...');
            
            // Verify the stored game is still valid
            const userData = await fetchWithRetry(getTeraboxUrl('/mergegame/getUserData'), {
                method: 'POST',
                body: JSON.stringify({"snsid": "game2"})
            });

            if (userData.data?.gameid === gameState.gameId) {
                gameId = gameState.gameId;
                currentLevel = gameState.level;
                addLog(`Resumed game ID: ${gameId} at level ${currentLevel}`);
            } else {
                addLog('Stored game is no longer valid, starting new game...');
                gameId = null;
                currentLevel = 2;
            }
        }

        // Start new game if we don't have a valid stored game
        if (!gameId) {
            currentLevel = 2;
            let gameResponse;
            try {
                gameResponse = await fetchWithRetry(getTeraboxUrl('/mergegame/getGameReward'), {
                    method: 'POST',
                    body: JSON.stringify({"gameid": 0, "level": currentLevel, "isFreeGame": 0})
                });
                addLog('Started new GemMerge game (paid version)');
            } catch {
                await delay(300);
                gameResponse = await fetchWithRetry(getTeraboxUrl('/mergegame/getGameReward'), {
                    method: 'POST',
                    body: JSON.stringify({"gameid": 0, "level": currentLevel, "isFreeGame": 1})
                });
                addLog('Started new GemMerge game');
            }

            gameId = gameResponse.data.gameid;
            addLog(`Game ID: ${gameId}`);
            parseGemMergeRewards(gameResponse.data?.rewards, 'Initial rewards');
        }

        // Store initial/resumed game state
        await saveGameState(gameId, currentLevel);
        
        // Play levels
        for (let level = currentLevel; level < 100; level++) {
            if (!isRunning) {
                addLog('Game stopped by user');
                // Save current progress before stopping
                await saveGameState(gameId, level);
                break;
            }

            for (let attempt = 0; attempt < 2; attempt++) {
                try {
                    addLog(`Attempting level ${level}...`);
                    
                    const levelUpResponse = await fetchWithRetry(getTeraboxUrl('/mergegame/sendGameLevelup'), {
                        method: 'POST',
                        body: JSON.stringify({
                            "level": level,
                            "isad": false,
                            "gameid": gameId
                        })
                    });

                    if (levelUpResponse.errno === 0) {
                        addLog(`Successfully completed level ${level}`);
                    }

                    await delay(300);

                    const rewardResponse = await fetchWithRetry(getTeraboxUrl('/mergegame/getGameReward'), {
                        method: 'POST',
                        body: JSON.stringify({
                            "gameid": gameId,
                            "level": level + 1,
                            "isFreeGame": 1
                        })
                    });

                    parseGemMergeRewards(rewardResponse.data?.rewards, `Level ${level + 1} rewards`);

                    await delay(300);

                    await fetchWithRetry(getTeraboxUrl('/mergegame/hasgotReward'), {
                        method: 'POST',
                        body: JSON.stringify({"gameid": gameId})
                    });

                    // Update stored state after successful level completion
                    await saveGameState(gameId, level + 1);
                    break;
                } catch (error) {
                    if (attempt === 1) {
                        addLog(`Failed to complete level ${level} after 2 attempts: ${error.message}`);
                    }
                    await delay(300);
                }
            }

            await delay(300);
        }

        // Get final reward
        addLog('Getting final game rewards...');
        const finalReward = await fetchWithRetry(getTeraboxUrl('/mergegame/getTotalReward'), {
            method: 'POST',
            body: JSON.stringify({"gameid": gameId})
        });

        parseGemMergeRewards(finalReward.data?.rewards, 'Final game rewards');
        addLog('GemMerge game session completed');

        // Clear stored game state upon successful completion
        await clearGameState();

    } catch (error) {
        addLog(`Error in GemMerge game: ${error.message}`);
        throw error;
    }
}

// Helper function to save game state
async function saveGameState(gameId, level) {
    return new Promise(resolve => {
        chrome.storage.local.set({
            gemMergeState: {
                gameId: gameId,
                level: level,
                timestamp: Date.now()
            }
        }, resolve);
    });
}

// Helper function to clear game state
async function clearGameState() {
    return new Promise(resolve => {
        chrome.storage.local.remove('gemMergeState', resolve);
    });
}

function parseGemMergeRewards(rewards, context = 'Rewards') {
    if (!rewards || !Array.isArray(rewards)) {
        addLog(`${context}: No rewards received`);
        return;
    }

    addLog(`${context}:`);
    
    let totalCoins = 0;
    let totalStorage = 0;
    let totalPremiumDays = 0;

    rewards.forEach(reward => {
        switch (reward.RewardType) {
            case 9: // Coins
                totalCoins += reward.RewardCount;
                addLog(`- ${reward.RewardCount} coins (${reward.ADTimes} ads available)`);
                break;
            case 3: // Storage
                totalStorage += reward.RewardCount;
                addLog(`- ${formatFileSize(reward.RewardCount)} storage (${reward.ADTimes} ads available)`);
                break;
            case 8: // Premium
                totalPremiumDays += reward.RewardCount;
                addLog(`- ${reward.RewardCount} premium days (${reward.ADTimes} ads available)`);
                break;
            default:
                addLog(`- Unknown reward type ${reward.RewardType}: ${reward.RewardCount} (${reward.ADTimes} ads available)`);
        }
    });

    if (totalCoins > 0 || totalStorage > 0 || totalPremiumDays > 0) {
        addLog('Total rewards received:');
        if (totalCoins > 0) addLog(`- Total coins: ${totalCoins}`);
        if (totalStorage > 0) addLog(`- Total storage: ${formatFileSize(totalStorage)}`);
        if (totalPremiumDays > 0) addLog(`- Total premium days: ${totalPremiumDays}`);
    }
}

function formatFileSize(bytes) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    
    while (size >= 1024 && unitIndex < units.length - 1) {
        size /= 1024;
        unitIndex++;
    }
    
    return `${size.toFixed(2)} ${units[unitIndex]}`;
}

function parseReward(rewardData) {
    const reward_kind = rewardData?.reward_kind;
    switch (reward_kind) {
        case 9:
            addLog(`Got Coins: ${rewardData.size}`);
            break;
        case 3:
            addLog(`Got Space: ${formatFileSize(rewardData.size)}`);
            break;
        case 6:
            addLog(`Got Catch-up Cards: ${rewardData.size}`);
            break;
        case 8:
            addLog(`Got Premium Days: ${rewardData.size}`);
            break;
        default:
            addLog(`Got Item: ${JSON.stringify(rewardData)}`);
    }
}

function delay(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function fetchWithRetry(url, options = {}, retries = 3) {
    try {
        const cookies = await getTeraboxCookies();
        const cookieString = cookies.map(cookie => `${cookie.name}=${cookie.value}`).join('; ');

        const headers = {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'Cookie': cookieString,
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36'
        };

        const response = await fetch(url, {
            method: options.method || 'GET',
            credentials: 'include',
            headers: headers,
            body: options.body,
            ...options
        });

        const data = await response.json();
        return data;
    } catch (error) {
        if (retries > 0) {
            addLog(`Fetch failed, retrying... (${retries} attempts left)`);
            await delay(500); // Reduced from 2000ms to 500ms
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
        
        coins = coinCountResponse.data.can_used_cnt;
        
        return {
            userInfo: userInfoResponse,
            coinCount: coinCountResponse
        };
    } catch (error) {
        addLog(`Error fetching user info and coin count: ${error.message}`);
        throw error;
    }
}

// Reset daily limit at midnight
function scheduleResetDailyLimit() {
    const now = new Date();
    const night = new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() + 1, // the next day
        0, 0, 0 // at 00:00:00 hours
    );
    const msToMidnight = night.getTime() - now.getTime();

    setTimeout(() => {
        dailyLimitReached = false;
        chrome.storage.local.set({ dailyLimitReached: false }).catch(console.error);
        addLog('Daily limit has been reset.');
        scheduleResetDailyLimit(); // Schedule the next reset
    }, msToMidnight);
}

scheduleResetDailyLimit()