document.addEventListener('DOMContentLoaded', function() {
    const welcomeScreen = document.getElementById('welcome-screen');
    const getStartedBtn = document.getElementById('get-started-btn');
    const profilePicture = document.getElementById('profile-picture');
    const username = document.getElementById('username');
    const coinCount = document.getElementById('coin-count');
    const startButton = document.getElementById('start-button');
    const stopButton = document.getElementById('stop-button');
    const logButton = document.getElementById('log-button');
    const logWindow = document.getElementById('log-window');
    const closeLogButton = document.getElementById('close-log');
    const logContent = document.getElementById('log-content');
    const teraboxButton = document.getElementById('terabox-button');

    function updateTeraboxButton(isLoggedIn) {
        if (isLoggedIn) {
            teraboxButton.textContent = 'Open TeraBox';
            teraboxButton.addEventListener('click', () => {
                chrome.tabs.create({ url: 'https://www.terabox.com' });
            });
        } else {
            teraboxButton.textContent = 'Sign Up for TeraBox';
            teraboxButton.addEventListener('click', () => {
                chrome.tabs.create({ url: 'https://terabox.com/s/1BjOBgtABLr0eRnUAEHWyug' });
            });
        }
    }

    function checkTeraboxLoginStatus() {
        updateUserInfoAndCoinCount();
    }

    checkTeraboxLoginStatus();

    chrome.storage.local.get('welcomeShown', (result) => {
        if (!result.welcomeShown) {
            welcomeScreen.style.display = 'flex';
            animateWelcomeScreen();
        } else {
            welcomeScreen.style.display = 'none';
        }
    });

    getStartedBtn.addEventListener('click', () => {
        welcomeScreen.classList.add('fade-out');
        setTimeout(() => {
            welcomeScreen.style.display = 'none';
            chrome.storage.local.set({ welcomeShown: true });
        }, 1000);
    });

    function animateWelcomeScreen() {
        const title = document.querySelector('.welcome-title');
        const description = document.querySelector('.welcome-description');
        const button = document.getElementById('get-started-btn');
        
        title.classList.add('animate-in');
        setTimeout(() => description.classList.add('animate-in'), 500);
        setTimeout(() => button.classList.add('animate-in'), 1000);
        
        const coinAnimation = document.querySelector('.coin-animation');
        for (let i = 0; i < 20; i++) {
            const coin = document.createElement('div');
            coin.classList.add('coin');
            coin.style.left = `${Math.random() * 100}%`;
            coin.style.animationDelay = `${Math.random() * 2}s`;
            coinAnimation.appendChild(coin);
        }
    }

    function updateUserInfoAndCoinCount() {
        chrome.runtime.sendMessage({action: 'getUserInfoAndCoinCount'}, response => {
            if (response.error) {
                console.error('Error fetching user info and coin count:', response.error);
                showError('Failed to load user info and coin count. Please check your connection and login status.');
            } else {
                if (response.userInfo.code === 0) {
                    profilePicture.src = response.userInfo.data.head_url;
                    username.textContent = response.userInfo.data.display_name;
                    updateTeraboxButton(true);
                } else {
                    console.error('Error fetching user info:', response.userInfo);
                    showError('Failed to load user info. Please check if you are logged in to TeraBox.');
                    updateTeraboxButton(false);
                }

                if (response.coinCount.errno === 0) {
                    coinCount.textContent = response.coinCount.data.can_used_cnt;
                } else {
                    console.error('Error fetching coin count:', response.coinCount);
                }
            }
        });
    }

    function updateButtonState(isRunning) {
        startButton.style.display = isRunning ? 'none' : 'block';
        stopButton.style.display = isRunning ? 'block' : 'none';
    }

    function sendMessage(message) {
        return new Promise((resolve, reject) => {
            chrome.runtime.sendMessage(message, response => {
                if (chrome.runtime.lastError) {
                    reject(chrome.runtime.lastError);
                } else {
                    resolve(response);
                }
            });
        });
    }

    startButton.addEventListener('click', async function() {
        try {
            const response = await sendMessage({action: 'startCollecting'});
            if (response && response.success) {
                updateButtonState(true);
            }
        } catch (error) {
            console.error('Error starting collection:', error);
            showError('Failed to start collection. Please try again.');
        }
    });

    stopButton.addEventListener('click', async function() {
        try {
            const response = await sendMessage({action: 'stopCollecting'});
            if (response && response.success) {
                updateButtonState(false);
            }
        } catch (error) {
            console.error('Error stopping collection:', error);
            showError('Failed to stop collection. Please try again.');
        }
    });

    logButton.addEventListener('click', function() {
        logWindow.classList.remove('hidden');
        updateLog();
    });

    closeLogButton.addEventListener('click', function() {
        logWindow.classList.add('hidden');
    });

    async function checkStatus() {
        try {
            const response = await sendMessage({action: 'getStatus'});
            updateButtonState(response.isRunning);
        } catch (error) {
            console.error('Error getting status:', error);
        }
    }

    async function updateLog() {
        try {
            const logs = await sendMessage({action: 'getLogs'});
            logContent.innerHTML = logs.map(log => `<div>${log}</div>`).join('');
            logContent.scrollTop = logContent.scrollHeight;
        } catch (error) {
            console.error('Error getting logs:', error);
        }
    }

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'updateCoinCount') {
            updateUserInfoAndCoinCount();
        } else if (request.action === 'logUpdated') {
            if (!logWindow.classList.contains('hidden')) {
                updateLog();
            }
        } else if (request.action === 'dailyLimitReached') {
            updateButtonState(false);
            startButton.textContent = 'Come Back Tomorrow';
            startButton.disabled = true;
        }
    });

    updateUserInfoAndCoinCount();
    checkStatus();

    setInterval(() => {
        updateUserInfoAndCoinCount();
        checkStatus();
    }, 30000);

    // Particle effect
    const canvas = document.getElementById('particleCanvas');
    const ctx = canvas.getContext('2d');
    let particles = [];

    function resizeCanvas() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }

    class Particle {
        constructor(x, y) {
            this.x = x;
            this.y = y;
            this.size = Math.random() * 5 + 1;
            this.speedX = Math.random() * 3 - 1.5;
            this.speedY = Math.random() * 3 - 1.5;
            this.color = `hsl(${Math.random() * 60 + 180}, 100%, 50%)`;
        }

        update() {
            this.x += this.speedX;
            this.y += this.speedY;
            if (this.size > 0.2) this.size -= 0.1;
        }

        draw() {
            ctx.fillStyle = this.color;
            ctx.beginPath();
            ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    function createParticles(e) {
        const rect = canvas.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const y = e.clientY - rect.top;

        for (let i = 0; i < 5; i++) {
            particles.push(new Particle(x, y));
        }
    }

    function animateParticles() {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = 0; i < particles.length; i++) {
            particles[i].update();
            particles[i].draw();

            if (particles[i].size <= 0.2) {
                particles.splice(i, 1);
                i--;
            }
        }
        requestAnimationFrame(animateParticles);
    }

    window.addEventListener('resize', resizeCanvas);
    document.addEventListener('mousemove', createParticles);

    resizeCanvas();
    animateParticles();

    // Custom cursor
    const cursor = document.querySelector('.cursor');

    document.addEventListener('mousemove', e => {
        cursor.setAttribute("style", "top: "+(e.pageY - 10)+"px; left: "+(e.pageX - 10)+"px;")
    })

    document.addEventListener('click', () => {
        cursor.classList.add("expand");
        setTimeout(() => {
            cursor.classList.remove("expand");
        }, 500)
    })
});

function showError(message) {
    const errorDiv = document.createElement('div');
    errorDiv.textContent = message;
    errorDiv.style.color = 'red';
    errorDiv.style.marginTop = '10px';
    document.getElementById('app').appendChild(errorDiv);
}