// The privacy page (privacy.html): shows the parts for this book only.
import './fonts.js';
import './styles/base.css';

import { BOOK } from './lib/edition.js';
import { registerServiceWorker } from './lib/pwa.js';

registerServiceWorker();
for (const part of document.querySelectorAll('[data-book]')) {
    if (part.dataset.book !== BOOK) part.remove();
}
