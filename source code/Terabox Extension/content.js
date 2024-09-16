chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'collectCoins') {
        collectCoins();
    }
});

async function collectCoins() {
    try {
        // Start the game
        const startResponse = await fetch('https://www.terabox.com/rest/1.0/imact/miner/start', {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        const startData = await startResponse.json();
        
        if (startData.errno !== 0) {
            throw new Error(`Failed to start the game. Error code: ${startData.errno}`);
        }

        const gameId = startData.data.game_id;
        const objectTypes = startData.data.map_info.items.map(item => item.object_type);

        // Process each object type
        for (const objectType of objectTypes) {
            const reportId = Array(16).fill(0).map(() => Math.floor(Math.random() * 10)).join('');
            const url = `https://www.terabox.com/rest/1.0/imact/miner/getitem?game_id=${gameId}&object_type=${objectType}&report_id=${reportId}`;
            
            await fetch(url, { 
                method: 'GET',
                credentials: 'include',
                headers: {
                    'Accept': 'application/json',
                    'Content-Type': 'application/json'
                }
            });
        }

        // Finish the game
        await fetch(`https://www.terabox.com/rest/1.0/imact/miner/finishgame?game_id=${gameId}`, {
            method: 'GET',
            credentials: 'include',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        console.log('Coin collection completed');
        chrome.runtime.sendMessage({action: 'collectionComplete'});

    } catch (error) {
        console.error('Error collecting coins:', error);
    }
}