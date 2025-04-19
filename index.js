const DiscordRPC = require('discord-rpc');
const puppeteer = require('puppeteer');

const clientId = '1363153003560964417';
const rpc = new DiscordRPC.Client({ transport: 'ipc' });

let currentActivity = null;
let page = null;

async function findYouTubeMusicTab() {
    try {
        // Try different debugging ports (Thorium might use a different port)
        const ports = [9222, 9223, 9224, 9225];
        
        for (const port of ports) {
            try {
                const browser = await puppeteer.connect({
                    browserURL: `http://127.0.0.1:${port}`,
                });

                const pages = await browser.pages();
                for (const p of pages) {
                    const url = await p.url();
                    const title = await p.title();
                    // Check both URL and page title to catch the YouTube Music app
                    if (url.includes('music.youtube.com') || 
                        title.includes('YouTube Music') || 
                        url.includes('youtube.com/watch')) {
                        console.log('Found YouTube Music!');
                        return p;
                    }
                }
            } catch (e) {
                continue; // Try next port
            }
        }
        return null;
    } catch (error) {
        console.error('Error connecting to browser:', error);
        console.log('Please make sure YouTube Music is open in your browser');
        return null;
    }
}

async function setupConnection() {
    console.log('Looking for YouTube Music tab...');
    page = await findYouTubeMusicTab();
    
    if (!page) {
        console.log('Could not find YouTube Music tab. Please make sure YouTube Music is open.');
        process.exit(1);
    }
    
    console.log('Successfully connected to YouTube Music!');
}

async function getCurrentSong() {
    if (!page) {
        return null;
    }
    
    try {
        const songInfo = await page.evaluate(() => {
            const title = document.querySelector('.title.style-scope.ytmusic-player-bar')?.textContent?.trim();
            const artist = document.querySelector('.byline.style-scope.ytmusic-player-bar a')?.textContent?.trim();
            
            // Enhanced album art detection with fallbacks
            const thumbnailSelectors = [
                '#song-image .thumbnail.style-scope.ytmusic-player img',
                '#song-image img',
                '.image.style-scope.ytmusic-player-bar',
                'img.style-scope.ytmusic-player-bar',
                '.thumbnail.style-scope.ytmusic-player'
            ];
            
            let thumbnail = null;
            for (const selector of thumbnailSelectors) {
                const img = document.querySelector(selector);
                if (img?.src) {
                    thumbnail = img.src.replace(/=w\d+-h\d+/, '=w500-h500');
                    if (thumbnail && !thumbnail.startsWith('data:')) break;
                }
            }
            
            const isPaused = document.querySelector('button[aria-label="Play"], .play-pause-button[title*="Play"]') !== null;
            
            const timeInfo = document.querySelector('.time-info')?.textContent?.trim() || '';
            const [currentTime = '0:00', duration = '0:00'] = timeInfo.split(' / ');
            
            const getCurrentTimestamp = (timeStr) => {
                if (!timeStr) return 0;
                const [minutes, seconds] = timeStr.split(':').map(Number);
                return minutes * 60 + seconds;
            };
            
            const currentSeconds = getCurrentTimestamp(currentTime);
            const totalSeconds = getCurrentTimestamp(duration);
            
            return {
                title,
                artist,
                thumbnail: thumbnail || 'default',
                isPaused,
                currentSeconds,
                totalSeconds,
                currentTime,
                duration
            };
        });

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
            return;
        }

        const now = Math.floor(Date.now() / 1000);
        const activity = {
            details: songInfo.title || 'Unknown Track',
            state: songInfo.isPaused ? 'Music Paused' : `by ${songInfo.artist || 'Unknown Artist'}`,
            largeImageKey: songInfo.thumbnail || 'youtube_music',
            largeImageText: `${songInfo.title} - ${songInfo.artist}`,
            smallImageKey: songInfo.isPaused ? 'pause' : 'play',
            smallImageText: songInfo.isPaused ? 'Paused' : `${songInfo.currentTime} / ${songInfo.duration}`,
            instance: false
        };

        if (!songInfo.isPaused && songInfo.totalSeconds > 0) {
            activity.startTimestamp = now - songInfo.currentSeconds;
            activity.endTimestamp = now + (songInfo.totalSeconds - songInfo.currentSeconds);
        }

        if (JSON.stringify(activity) !== JSON.stringify(currentActivity)) {
            console.log('Updating activity:', activity);
            await rpc.setActivity(activity);
            currentActivity = activity;
        }
    } catch (error) {
        console.error('Error updating activity:', error);
    }
}

rpc.on('ready', async () => {
    await setupConnection();
    updateActivity();
    setInterval(updateActivity, 1000);
});

process.on('unhandledRejection', console.error);
process.on('SIGINT', () => {
    rpc.destroy();
    process.exit();
});

console.log('Connecting to Discord...');
rpc.login({ clientId }).catch(console.error);