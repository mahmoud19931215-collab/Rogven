/**
 * ================================
 * script.js – Reels Feed Engine
 * (Vanilla JS | Virtual Scroll | Smart Play/Pause | Pre-fetching)
 * المطور: محمود | بيئة: أجهزة ضعيفة / إنترنت مقيد
 * التعديل: دعم رابط Google Apps Script (JSON/CSV) مع تخزين مؤقت
 * ================================
 */
(function() {
    'use strict';

    // ================================
    // Island 1: إعدادات Google Sheets (رابط Apps Script)
    // ================================
    const SHEET_CSV_URL = 'https://script.google.com/macros/s/AKfycbzHD_WS_HyoZO56CLuoA1APvjcqdeQTThvzB_KahER_YOkQnVCG-HDaNXtj46J56caF/exec';

    // ================================
    // Island 2: الحالة العامة للتطبيق
    // ================================
    const STATE = {
        videoData: [],
        currentIndex: 0,
        previousIndex: -1,
        isScrolling: false,
        scrollTimeout: null,
        isMuted: true,
        likedVideos: {},
        likeCounts: {},
        observer: null,
        container: null,
        preloadQueue: new Set(),
        destroyedIndices: new Set(),
        isDataReady: false
    };

    // ================================
    // Island 3: جلب البيانات من Google Apps Script مع تخزين مؤقت
    // ================================
    async function fetchVideoData() {
        const cached = localStorage.getItem('reels_video_data_cache');
        let data = null;

        try {
            const response = await fetch(SHEET_CSV_URL, { cache: 'no-cache' });
            if (!response.ok) throw new Error('Network response failed');

            const contentType = response.headers.get('content-type') || '';
            const rawText = await response.text();

            // محاولة تحليل الاستجابة كـ JSON أولاً
            if (contentType.includes('json') || rawText.trim().startsWith('[') || rawText.trim().startsWith('{')) {
                try {
                    const json = JSON.parse(rawText);
                    // نتوقع إما مصفوفة مباشرة أو كائن يحتوي على data
                    data = Array.isArray(json) ? json : (json.data || []);
                } catch (e) {
                    // إذا فشل JSON ننتقل لتحليل CSV
                    data = null;
                }
            }

            // إذا لم يتم تحليل JSON، تعامل معه كـ CSV
            if (!data) {
                data = parseCSV(rawText);
            }

            // تخزين مؤقت ناجح
            try {
                localStorage.setItem('reels_video_data_cache', JSON.stringify(data));
            } catch (e) { /* ignore quota */ }
            console.log('✅ Fetched fresh data:', data.length, 'videos');
        } catch (err) {
            console.warn('⚠️ Could not fetch live data, using cache:', err.message);
            if (cached) {
                data = JSON.parse(cached);
                console.log('📦 Loaded data from localStorage cache');
            }
        }

        if (!data || data.length === 0) {
            console.warn('🆘 No data available, loading fallback videos');
            data = getFallbackData();
        }

        STATE.videoData = data;
        data.forEach(v => {
            STATE.likeCounts[v.id] = v.likes;
            STATE.likedVideos[v.id] = false;
        });
        STATE.isDataReady = true;
    }

    /**
     * تحويل CSV نصي إلى مصفوفة كائنات
     * التنسيق المفترض: id,src,username,caption,likes,verified
     */
    function parseCSV(csvText) {
        const lines = csvText.trim().split('\n');
        if (lines.length < 2) return [];
        const headers = lines[0].split(',').map(h => h.trim());
        const rows = lines.slice(1);
        const result = [];

        for (const line of rows) {
            const values = parseCSVLine(line);
            if (values.length < headers.length) continue;
            const obj = {};
            headers.forEach((header, i) => {
                obj[header] = values[i] ? values[i].trim() : '';
            });
            obj.likes = parseInt(obj.likes, 10) || 0;
            obj.verified = obj.verified === 'true' || obj.verified === 'TRUE';
            result.push(obj);
        }
        return result;
    }

    function parseCSVLine(line) {
        const result = [];
        let current = '';
        let inQuotes = false;
        for (const char of line) {
            if (char === '"') {
                inQuotes = !inQuotes;
            } else if (char === ',' && !inQuotes) {
                result.push(current);
                current = '';
            } else {
                current += char;
            }
        }
        result.push(current);
        return result;
    }

    function getFallbackData() {
        return [
            {
                id: 'fb1',
                src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerBlazes.mp4',
                username: 'محمود | Mahmoud',
                caption: '🎬 بيانات احتياطية – يرجى ربط Google Sheets',
                likes: 100,
                verified: true
            },
            {
                id: 'fb2',
                src: 'https://commondatastorage.googleapis.com/gtv-videos-bucket/sample/ForBiggerEscapes.mp4',
                username: 'Reels Feed',
                caption: '⚡️ اختبر الاتصال بالـ Sheet',
                likes: 50,
                verified: false
            }
        ];
    }

    // ================================
    // Island 4: بناء هيكل DOM لعنصر Reel واحد
    // ================================
    function buildReelItem(data, index) {
        const item = document.createElement('div');
        item.className = 'reel-item';
        item.setAttribute('data-index', index);
        item.setAttribute('data-video-id', data.id);

        const video = document.createElement('video');
        video.className = 'reel-video';
        video.setAttribute('playsinline', '');
        video.setAttribute('webkit-playsinline', '');
        video.setAttribute('x-webkit-airplay', 'deny');
        video.setAttribute('disableRemotePlayback', '');
        video.setAttribute('preload', 'none');
        video.setAttribute('loop', '');
        video.setAttribute('muted', '');
        video.setAttribute('poster', data.poster || '');
        item.appendChild(video);

        const loader = document.createElement('div');
        loader.className = 'loading-indicator';
        loader.innerHTML = '<div class="loading-spinner"></div>';
        item.appendChild(loader);

        const overlay = document.createElement('div');
        overlay.className = 'reel-overlay';

        const actions = document.createElement('div');
        actions.className = 'reel-actions';

        const likeBtn = document.createElement('button');
        likeBtn.className = 'action-btn like-btn';
        likeBtn.setAttribute('aria-label', 'إعجاب');
        likeBtn.innerHTML = `
            <svg class="like-icon" width="32" height="32"><use href="#icon-heart"/></svg>
            <span class="action-label like-count">${formatCount(data.likes)}</span>
        `;
        actions.appendChild(likeBtn);

        const shareBtn = document.createElement('button');
        shareBtn.className = 'action-btn share-btn';
        shareBtn.setAttribute('aria-label', 'مشاركة');
        shareBtn.innerHTML = `
            <svg width="32" height="32"><use href="#icon-share"/></svg>
            <span class="action-label">مشاركة</span>
        `;
        actions.appendChild(shareBtn);
        overlay.appendChild(actions);

        const muteBtn = document.createElement('button');
        muteBtn.className = 'mute-btn-top';
        muteBtn.setAttribute('aria-label', 'كتم / تفعيل الصوت');
        muteBtn.innerHTML = `<svg width="22" height="22"><use href="#icon-volume-off"/></svg>`;
        overlay.appendChild(muteBtn);

        const info = document.createElement('div');
        info.className = 'reel-info';
        info.innerHTML = `
            <span class="reel-username">
                ${escapeHTML(data.username)}
                ${data.verified ? '<svg class="verified-badge" width="18" height="18"><use href="#icon-verified"/></svg>' : ''}
            </span>
            <span class="reel-caption">${escapeHTML(data.caption)}</span>
        `;
        overlay.appendChild(info);

        const progressTrack = document.createElement('div');
        progressTrack.className = 'progress-track';
        progressTrack.innerHTML = '<div class="progress-fill"></div>';
        overlay.appendChild(progressTrack);

        const heartBurst = document.createElement('div');
        heartBurst.className = 'heart-burst';
        heartBurst.innerHTML = '<svg width="90" height="90"><use href="#icon-heart-large"/></svg>';
        overlay.appendChild(heartBurst);

        item.appendChild(overlay);
        return item;
    }

    // ================================
    // Island 5: دوال مساعدة
    // ================================
    function escapeHTML(str) {
        const div = document.createElement('div');
        div.textContent = str;
        return div.innerHTML;
    }

    function formatCount(num) {
        if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
        return num.toString();
    }

    // ================================
    // Island 6: إدارة دورة حياة الفيديو (Virtualization Core)
    // ================================
    function getVideoElement(index) {
        const item = STATE.container.querySelector(`.reel-item[data-index="${index}"]`);
        return item ? item.querySelector('.reel-video') : null;
    }

    function getReelItem(index) {
        return STATE.container.querySelector(`.reel-item[data-index="${index}"]`);
    }

    function activateVideo(index) {
        const video = getVideoElement(index);
        const item = getReelItem(index);
        if (!video || !item) return;
        const data = STATE.videoData[index];
        if (!data) return;

        if (STATE.destroyedIndices.has(index) || !video.src || video.src === window.location.href) {
            video.setAttribute('preload', 'auto');
            video.src = data.src;
            STATE.destroyedIndices.delete(index);
            const loader = item.querySelector('.loading-indicator');
            if (loader) loader.classList.add('active');
        }

        video.muted = STATE.isMuted;

        const playPromise = video.play();
        if (playPromise !== undefined) {
            playPromise.then(() => {
                const loader = item.querySelector('.loading-indicator');
                if (loader) loader.classList.remove('active');
            }).catch(err => {
                console.warn('Auto-play blocked for index', index, err.message);
                const loader = item.querySelector('.loading-indicator');
                if (loader) loader.classList.remove('active');
            });
        }

        updateMuteIcon(index);
        startProgressTracking(index, video);
        attachVideoEvents(index, video);
    }

    function deactivateVideo(index, destroyFar = false) {
        const video = getVideoElement(index);
        if (!video) return;

        video.pause();
        removeProgressTracking(index, video);
        removeVideoEvents(index, video);

        if (destroyFar) {
            video.removeAttribute('src');
            video.load();
            STATE.destroyedIndices.add(index);
            const item = getReelItem(index);
            if (item) {
                const loader = item.querySelector('.loading-indicator');
                if (loader) loader.classList.remove('active');
                const progressFill = item.querySelector('.progress-fill');
                if (progressFill) progressFill.style.width = '0%';
            }
        } else {
            video.currentTime = 0;
            const item = getReelItem(index);
            if (item) {
                const progressFill = item.querySelector('.progress-fill');
                if (progressFill) progressFill.style.width = '0%';
            }
        }
    }

    function preloadNextVideo(index) {
        const nextIndex = index + 1;
        if (nextIndex >= STATE.videoData.length) return;
        if (STATE.preloadQueue.has(nextIndex)) return;

        const video = getVideoElement(nextIndex);
        if (!video) return;
        if (!video.src || video.src === window.location.href || STATE.destroyedIndices.has(nextIndex)) {
            const data = STATE.videoData[nextIndex];
            video.setAttribute('preload', 'auto');
            video.src = data.src;
            STATE.destroyedIndices.delete(nextIndex);
            STATE.preloadQueue.add(nextIndex);
        }
    }

    function cleanupDistantVideos(currentIdx) {
        for (let i = 0; i < STATE.videoData.length; i++) {
            if (Math.abs(i - currentIdx) > 2) {
                const video = getVideoElement(i);
                if (video && video.src && video.src !== window.location.href && !STATE.destroyedIndices.has(i)) {
                    deactivateVideo(i, true);
                }
            }
        }
        STATE.preloadQueue.forEach(idx => {
            if (Math.abs(idx - currentIdx) > 2) STATE.preloadQueue.delete(idx);
        });
    }

    // ================================
    // Island 7: تتبع شريط التقدم
    // ================================
    const progressIntervals = new Map();

    function startProgressTracking(index, video) {
        removeProgressTracking(index, video);
        const item = getReelItem(index);
        if (!item) return;
        const progressFill = item.querySelector('.progress-fill');
        if (!progressFill) return;

        const onTimeUpdate = () => {
            if (video.duration && isFinite(video.duration)) {
                const pct = (video.currentTime / video.duration) * 100;
                progressFill.style.width = pct.toFixed(2) + '%';
            }
        };
        video.addEventListener('timeupdate', onTimeUpdate, { passive: true });
        progressIntervals.set(index, { video, onTimeUpdate });
    }

    function removeProgressTracking(index, video) {
        const entry = progressIntervals.get(index);
        if (entry) {
            entry.video.removeEventListener('timeupdate', entry.onTimeUpdate);
            progressIntervals.delete(index);
        }
        const item = getReelItem(index);
        if (item) {
            const progressFill = item.querySelector('.progress-fill');
            if (progressFill) progressFill.style.width = '0%';
        }
    }

    // ================================
    // Island 8: أحداث الفيديو
    // ================================
    const videoEventHandlers = new Map();

    function attachVideoEvents(index, video) {
        const onLoadedData = () => {
            const item = getReelItem(index);
            if (item) {
                const loader = item.querySelector('.loading-indicator');
                if (loader) loader.classList.remove('active');
            }
        };
        const onWaiting = () => {
            const item = getReelItem(index);
            if (item) {
                const loader = item.querySelector('.loading-indicator');
                if (loader && !video.paused) loader.classList.add('active');
            }
        };
        video.addEventListener('loadeddata', onLoadedData, { passive: true });
        video.addEventListener('waiting', onWaiting, { passive: true });
        videoEventHandlers.set(index, { onLoadedData, onWaiting });
    }

    function removeVideoEvents(index, video) {
        const handlers = videoEventHandlers.get(index);
        if (handlers) {
            video.removeEventListener('loadeddata', handlers.onLoadedData);
            video.removeEventListener('waiting', handlers.onWaiting);
            videoEventHandlers.delete(index);
        }
    }

    // ================================
    // Island 9: كتم الصوت
    // ================================
    function updateMuteIcon(index) {
        const item = getReelItem(index);
        if (!item) return;
        const muteBtn = item.querySelector('.mute-btn-top');
        if (!muteBtn) return;
        const iconUse = muteBtn.querySelector('use');
        if (!iconUse) return;
        if (STATE.isMuted) {
            iconUse.setAttribute('href', '#icon-volume-off');
            muteBtn.setAttribute('aria-label', 'تفعيل الصوت');
        } else {
            iconUse.setAttribute('href', '#icon-volume-on');
            muteBtn.setAttribute('aria-label', 'كتم الصوت');
        }
    }

    function updateAllMuteIcons() {
        for (let i = 0; i < STATE.videoData.length; i++) {
            updateMuteIcon(i);
            const video = getVideoElement(i);
            if (video) video.muted = STATE.isMuted;
        }
    }

    // ================================
    // Island 10: إدارة الإعجابات
    // ================================
    function toggleLike(index) {
        const data = STATE.videoData[index];
        if (!data) return;
        const videoId = data.id;
        const currentlyLiked = STATE.likedVideos[videoId] || false;

        if (currentlyLiked) {
            STATE.likedVideos[videoId] = false;
            STATE.likeCounts[videoId] = Math.max(0, (STATE.likeCounts[videoId] || data.likes) - 1);
        } else {
            STATE.likedVideos[videoId] = true;
            STATE.likeCounts[videoId] = (STATE.likeCounts[videoId] || data.likes) + 1;
        }

        const item = getReelItem(index);
        if (!item) return;
        const likeBtn = item.querySelector('.like-btn');
        const likeIcon = likeBtn ? likeBtn.querySelector('.like-icon use') : null;
        const likeCountEl = likeBtn ? likeBtn.querySelector('.like-count') : null;
        if (likeIcon) likeIcon.setAttribute('href', STATE.likedVideos[videoId] ? '#icon-heart-filled' : '#icon-heart');
        if (likeBtn) likeBtn.classList.toggle('liked', STATE.likedVideos[videoId]);
        if (likeCountEl) likeCountEl.textContent = formatCount(STATE.likeCounts[videoId]);

        try {
            const saved = JSON.parse(localStorage.getItem('reels_liked') || '{}');
            saved[videoId] = STATE.likedVideos[videoId];
            localStorage.setItem('reels_liked', JSON.stringify(saved));
        } catch (e) { /* ignore */ }
    }

    function restoreLikesFromStorage() {
        try {
            const saved = JSON.parse(localStorage.getItem('reels_liked') || '{}');
            Object.keys(saved).forEach(videoId => {
                if (saved[videoId]) {
                    STATE.likedVideos[videoId] = true;
                    STATE.likeCounts[videoId] = (STATE.likeCounts[videoId] || 0) + 1;
                }
            });
        } catch (e) { /* ignore */ }
    }

    // ================================
    // Island 11: Double‑Tap
    // ================================
    function triggerHeartBurst(index) {
        const item = getReelItem(index);
        if (!item) return;
        const heartBurst = item.querySelector('.heart-burst');
        if (!heartBurst) return;
        heartBurst.classList.remove('animate');
        void heartBurst.offsetWidth;
        heartBurst.classList.add('animate');
        const data = STATE.videoData[index];
        if (data && !STATE.likedVideos[data.id]) toggleLike(index);
    }

    // ================================
    // Island 12: Intersection Observer
    // ================================
    function setupIntersectionObserver() {
        const options = { root: STATE.container, rootMargin: '0px', threshold: 0.95 };
        STATE.observer = new IntersectionObserver((entries) => {
            if (STATE.isScrolling) return;
            entries.forEach(entry => {
                const index = parseInt(entry.target.getAttribute('data-index'), 10);
                if (isNaN(index)) return;
                if (entry.isIntersecting && entry.intersectionRatio >= 0.95 && STATE.currentIndex !== index) {
                    handleIndexChange(index);
                }
            });
        }, options);
        const items = STATE.container.querySelectorAll('.reel-item');
        items.forEach(item => STATE.observer.observe(item));
    }

    function handleIndexChange(newIndex) {
        if (newIndex === STATE.currentIndex) return;
        if (newIndex < 0 || newIndex >= STATE.videoData.length) return;
        const oldIndex = STATE.currentIndex;
        STATE.previousIndex = oldIndex;
        STATE.currentIndex = newIndex;

        if (oldIndex >= 0 && oldIndex < STATE.videoData.length) deactivateVideo(oldIndex, false);
        activateVideo(newIndex);
        preloadNextVideo(newIndex);
        cleanupDistantVideos(newIndex);

        try { sessionStorage.setItem('reels_current_index', newIndex); } catch (e) {}

        const data = STATE.videoData[newIndex];
        if (data) {
            const item = getReelItem(newIndex);
            if (item) {
                const likeBtn = item.querySelector('.like-btn');
                const likeIcon = likeBtn ? likeBtn.querySelector('.like-icon use') : null;
                const likeCountEl = likeBtn ? likeBtn.querySelector('.like-count') : null;
                if (likeIcon) likeIcon.setAttribute('href', STATE.likedVideos[data.id] ? '#icon-heart-filled' : '#icon-heart');
                if (likeBtn) likeBtn.classList.toggle('liked', !!STATE.likedVideos[data.id]);
                if (likeCountEl) likeCountEl.textContent = formatCount(STATE.likeCounts[data.id]);
            }
        }
    }

    // ================================
    // Island 13: معالج التمرير
    // ================================
    function onScrollEnd() {
        STATE.isScrolling = false;
        const containerRect = STATE.container.getBoundingClientRect();
        const containerCenter = containerRect.top + containerRect.height / 2;
        let bestIndex = STATE.currentIndex;
        let bestDistance = Infinity;
        const items = STATE.container.querySelectorAll('.reel-item');
        items.forEach(item => {
            const rect = item.getBoundingClientRect();
            const itemCenter = rect.top + rect.height / 2;
            const distance = Math.abs(itemCenter - containerCenter);
            if (distance < bestDistance) {
                bestDistance = distance;
                bestIndex = parseInt(item.getAttribute('data-index'), 10);
            }
        });
        if (bestIndex >= 0 && bestIndex < STATE.videoData.length && bestIndex !== STATE.currentIndex) {
            handleIndexChange(bestIndex);
        }
    }

    function onScroll() {
        STATE.isScrolling = true;
        if (STATE.scrollTimeout) clearTimeout(STATE.scrollTimeout);
        STATE.scrollTimeout = setTimeout(onScrollEnd, 280);
    }

    // ================================
    // Island 14: ربط الأحداث التفاعلية
    // ================================
    function attachInteractionEvents(index) {
        const item = getReelItem(index);
        if (!item) return;

        const likeBtn = item.querySelector('.like-btn');
        if (likeBtn && !likeBtn._eventsBound) {
            likeBtn._eventsBound = true;
            likeBtn.addEventListener('click', (e) => { e.stopPropagation(); toggleLike(index); });
        }

        const shareBtn = item.querySelector('.share-btn');
        if (shareBtn && !shareBtn._eventsBound) {
            shareBtn._eventsBound = true;
            shareBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                const data = STATE.videoData[index];
                if (navigator.share) {
                    navigator.share({ title: data.username, text: data.caption, url: data.src }).catch(() => {});
                } else {
                    navigator.clipboard.writeText(data.src).then(() => {
                        const label = shareBtn.querySelector('.action-label');
                        if (label) { label.textContent = 'تم النسخ!'; setTimeout(() => { label.textContent = 'مشاركة'; }, 1800); }
                    }).catch(() => {});
                }
            });
        }

        const muteBtn = item.querySelector('.mute-btn-top');
        if (muteBtn && !muteBtn._eventsBound) {
            muteBtn._eventsBound = true;
            muteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                STATE.isMuted = !STATE.isMuted;
                updateAllMuteIcons();
                try { localStorage.setItem('reels_muted', STATE.isMuted ? '1' : '0'); } catch (e) {}
            });
        }

        if (!item._dblTapBound) {
            item._dblTapBound = true;
            let tapCount = 0, tapTimer = null;
            item.addEventListener('click', (e) => {
                if (e.target.closest('button')) return;
                tapCount++;
                if (tapCount === 1) {
                    tapTimer = setTimeout(() => {
                        tapCount = 0;
                        const video = getVideoElement(index);
                        if (video) video.paused ? video.play().catch(() => {}) : video.pause();
                    }, 280);
                } else if (tapCount === 2) {
                    clearTimeout(tapTimer);
                    tapCount = 0;
                    triggerHeartBurst(index);
                }
            });
        }
    }

    function attachAllInteractionEvents() {
        for (let i = 0; i < STATE.videoData.length; i++) attachInteractionEvents(i);
    }

    // ================================
    // Island 15: استعادة حالات التخزين
    // ================================
    function restoreMuteState() {
        try {
            const saved = localStorage.getItem('reels_muted');
            STATE.isMuted = (saved !== '0');
        } catch (e) { STATE.isMuted = true; }
    }

    // ================================
    // Island 16: التهيئة الرئيسية (تنتظر البيانات)
    // ================================
    async function bootstrap() {
        STATE.container = document.getElementById('reelsContainer');
        if (!STATE.container) return;

        STATE.container.innerHTML = '<div style="color:#fff;text-align:center;padding-top:45vh;font-size:18px">⏳ جاري تحميل الفيديوهات...</div>';

        await fetchVideoData();

        STATE.container.innerHTML = '';

        STATE.videoData.forEach((data, index) => {
            const reelItem = buildReelItem(data, index);
            STATE.container.appendChild(reelItem);
        });

        restoreMuteState();
        restoreLikesFromStorage();

        attachAllInteractionEvents();
        setupIntersectionObserver();
        STATE.container.addEventListener('scroll', onScroll, { passive: true });

        let startIndex = 0;
        try {
            const saved = sessionStorage.getItem('reels_current_index');
            if (saved !== null) {
                const parsed = parseInt(saved, 10);
                if (parsed >= 0 && parsed < STATE.videoData.length) startIndex = parsed;
            }
        } catch (e) {}

        STATE.currentIndex = startIndex;
        const targetItem = getReelItem(startIndex);
        if (targetItem) targetItem.scrollIntoView({ behavior: 'instant', block: 'start' });

        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                activateVideo(startIndex);
                preloadNextVideo(startIndex);
                updateMuteIcon(startIndex);
                const data = STATE.videoData[startIndex];
                if (data && STATE.likedVideos[data.id]) {
                    const item = getReelItem(startIndex);
                    if (item) {
                        const likeBtn = item.querySelector('.like-btn');
                        const likeIcon = likeBtn ? likeBtn.querySelector('.like-icon use') : null;
                        const likeCountEl = likeBtn ? likeBtn.querySelector('.like-count') : null;
                        if (likeIcon) likeIcon.setAttribute('href', '#icon-heart-filled');
                        if (likeBtn) likeBtn.classList.add('liked');
                        if (likeCountEl) likeCountEl.textContent = formatCount(STATE.likeCounts[data.id]);
                    }
                }
            });
        });

        document.addEventListener('visibilitychange', () => {
            if (document.hidden) {
                const video = getVideoElement(STATE.currentIndex);
                if (video && !video.paused) video.pause();
            } else {
                const video = getVideoElement(STATE.currentIndex);
                if (video && video.paused) video.play().catch(() => {});
            }
        });

        console.log('✅ Reels Feed initialized from Google Sheets —', STATE.videoData.length, 'videos ready.');
    }

    // ================================
    // Island 17: بدء التشغيل
    // ================================
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bootstrap);
    } else {
        bootstrap();
    }
})();
