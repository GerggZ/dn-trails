import { asset, el } from '../lib/data.js';

export function renderGallery(photos) {
    const container = document.getElementById('photo-container');
    const grid = document.getElementById('photo-grid');
    const lightbox = document.getElementById('lightbox');
    const lightboxImg = document.getElementById('lightbox-img');
    const lightboxCaption = document.getElementById('lightbox-caption');

    if (!photos.length) return;
    container.hidden = false;

    let current = 0;

    const show = (i) => {
        current = (i + photos.length) % photos.length; // wraps around both ways
        lightboxImg.src = asset(photos[current].src);
        lightboxCaption.textContent = photos[current].caption;
    };
    const open = (i) => {
        opener = document.activeElement;
        show(i);
        lightbox.classList.add('active');
        document.querySelector('.lightbox-close').focus();
    };
    let opener = null;
    const close = () => {
        lightbox.classList.remove('active');
        opener?.focus();
    };

    photos.forEach((photo, i) => {
        const img = el('img', { src: asset(photo.thumb), alt: photo.caption, loading: 'lazy' });
        // Reserve the right shape before the image loads (no jumping layout)
        img.width = photo.width;
        img.height = photo.height;
        const button = el('button', { type: 'button', ariaLabel: photo.caption || `Open photo ${i + 1}` }, img);
        button.addEventListener('click', () => open(i));
        grid.append(el('figure', { className: 'photo-card' },
            button,
            photo.caption && el('figcaption', { className: 'photo-caption', textContent: photo.caption }),
        ));
    });

    document.querySelector('.lightbox-close').addEventListener('click', close);
    lightbox.addEventListener('click', (e) => { if (e.target === lightbox) close(); });
    document.querySelector('.lightbox-prev').addEventListener('click', (e) => { e.stopPropagation(); show(current - 1); });
    document.querySelector('.lightbox-next').addEventListener('click', (e) => { e.stopPropagation(); show(current + 1); });

    document.addEventListener('keydown', (e) => {
        if (!lightbox.classList.contains('active')) return;
        if (e.key === 'Escape') close();
        if (e.key === 'ArrowLeft') show(current - 1);
        if (e.key === 'ArrowRight') show(current + 1);
    });

    // Mobile swipe
    let touchStartX = 0;
    lightbox.addEventListener('touchstart', (e) => { touchStartX = e.changedTouches[0].screenX; });
    lightbox.addEventListener('touchend', (e) => {
        const dx = e.changedTouches[0].screenX - touchStartX;
        if (dx < -50) show(current + 1);
        if (dx > 50) show(current - 1);
    });
}
