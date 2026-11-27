// Which book this build is (public hiking book or the wedding book) and its settings
// from config.js `editions`. Set by vite.config.js from BOOK in the .env file.

/* global __BOOK__ */
import { APP_CONFIG } from '../config.js';

export const BOOK = __BOOK__;
export const EDITION = APP_CONFIG.editions[BOOK] ?? APP_CONFIG.editions.public;

/** The book's name: site bar, tab titles, installed app. */
export const BOOK_NAME = EDITION.name;

/** false in the wedding book: no demo users or menu lists, every hike visible. */
export const ACCOUNTS = EDITION.accounts !== false;
