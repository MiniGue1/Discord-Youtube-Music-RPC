const DiscordRPC = require('discord-rpc');
const puppeteer = require('puppeteer');

const clientId = '1363153003560964417'; // Replace with your Discord application client ID
const rpc = new DiscordRPC.Client({ transport: 'ipc' });

let currentActivity = null;
let browser = null;
let page = null;

async function setupBrowser() {
    console.log('Setting up browser...');
    browser = await puppeteer.launch({ 
        headless: false, // Make browser visible
        args: ['--no-sandbox', '--disable-web-security'],
        defaultViewport: null
    });
    page = await browser.newPage();
    console.log('Navigating to YouTube Music...');
    await page.goto('https://music.youtube.com', { waitUntil: 'networkidle0', timeout: 60000 });
    
    // Wait for user to log in if needed
    try {
        await page.waitForSelector('.title.style-scope.ytmusic-player-bar', { timeout: 30000 });
        console.log('Music player detected!');
    } catch (error) {
        console.log('Please log in to YouTube Music in the browser window and start playing a song');
        // Keep waiting for the player to appear
        await page.waitForSelector('.title.style-scope.ytmusic-player-bar', { timeout: 0 });
        console.log('Music player detected after login!');
    }
    console.log('Browser setup complete');
}

async function getCurrentSong() {
    if (!page) {
        console.log('Page not initialized');
        return null;
    }
    
    try {
        const songInfo = await page.evaluate(() => {
            const title = document.querySelector('.title.style-scope.ytmusic-player-bar')?.textContent?.trim();
            const artist = document.querySelector('.byline.style-scope.ytmusic-player-bar')?.textContent?.trim();
            
            // Get high quality album art
            const thumbnail = document.querySelector('.image.style-scope.ytmusic-player-bar')?.src?.replace('w60-h60', 'w500-h500');
            
            // Check if music is paused
            const isPaused = document.querySelector('button.play-pause-button')?.getAttribute('title')?.includes('Play');
            
            // Get detailed time information
            const timeInfo = document.querySelector('.time-info')?.textContent?.trim() || '';
            const [currentTime, duration] = timeInfo.split(' / ');
            
            const getCurrentTimestamp = (timeStr) => {
                if (!timeStr) return 0;
                const [minutes, seconds] = timeStr.split(':').map(Number);
                return minutes * 60 + seconds;
            };
            
            const currentSeconds = getCurrentTimestamp(currentTime);
            const totalSeconds = getCurrentTimestamp(duration);
            
            // Get album name if available
            const album = document.querySelector('.subtitle.style-scope.ytmusic-player-bar yt-formatted-string:nth-child(3)')?.textContent?.trim();
            
            return {
                title,
                artist,
                thumbnail,
                isPaused,
                currentSeconds,
                totalSeconds,
                album,
                currentTime,
                duration
            };
        });

        console.log('Current song info:', songInfo);
        return songInfo;
    } catch (error) {
        console.error('Error getting song info:', error);
        return null;
    }
}

async function updateActivity() {
    try {
        const songInfo = await getCurrentSong();
        if (!songInfo) {
            console.log('No song info available');
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const activity = {
            details: songInfo.title || 'Unknown Track',
            state: `by ${songInfo.artist}${songInfo.album ? ` • ${songInfo.album}` : ''}`,
            largeImageKey: songInfo.thumbnail || 'youtube_music',
            largeImageText: `${songInfo.title} - ${songInfo.artist}`,
            smallImageKey: songInfo.isPaused ? 'pause' : 'play',
            smallImageText: `${songInfo.currentTime} / ${songInfo.duration}`,
            instance: false,
        };

        if (!songInfo.isPaused && songInfo.totalSeconds > 0) {
            activity.startTimestamp = now - songInfo.currentSeconds;
            activity.endTimestamp = now + (songInfo.totalSeconds - songInfo.currentSeconds);
        }

        console.log('Setting activity:', activity);
        await rpc.setActivity(activity);
        console.log('Activity set successfully');
        currentActivity = activity;
    } catch (error) {
        console.error('Error updating activity:', error);
    }
}

// Handle Discord RPC events
rpc.on('ready', async () => {
    console.log('Discord RPC Connected! User:', rpc.user.username);
    await setupBrowser();
    setInterval(updateActivity, 5000);
    updateActivity();
});

rpc.on('connected', () => {
    console.log('Connected to Discord!');
});

rpc.on('disconnected', () => {
    console.log('Disconnected from Discord!');
});

process.on('unhandledRejection', error => {
    console.error('Unhandled promise rejection:', error);
});

process.on('SIGINT', async () => {
    console.log('Shutting down...');
    if (browser) await browser.close();
    rpc.destroy();
    process.exit();
});

// Connect to Discord
console.log('Connecting to Discord...');
rpc.login({ clientId }).catch(console.error);