// "Viewing as" picker in the site bar (where a login button would go).
// DEMO only: switches the pretend user; the page reloads so everything is
// shown the way that person would see it.

import { currentUserId, setCurrentUser, loadUsers, el } from './data.js';

export async function setupViewingAs(bar) {
    if (!bar) return;
    const { users } = await loadUsers();
    const select = el('select', { id: 'viewing-as', className: 'viewing-as-select' },
        el('option', { value: '', textContent: 'Guest' }),
        users.map((u) => el('option', { value: u.id, textContent: u.admin ? `${u.name} (admin)` : u.name })),
    );
    const current = currentUserId();
    select.value = users.some((u) => u.id === current) ? current : '';
    select.addEventListener('change', () => {
        setCurrentUser(select.value);
        window.location.reload();
    });

    bar.append(el('div', { className: 'viewing-as' },
        el('label', { htmlFor: 'viewing-as', textContent: 'Viewing as' }),
        select,
        el('span', {
            className: 'demo-tag',
            textContent: 'demo',
            title: 'Demo: no real logins. Everything in this book is public for now.',
        }),
    ));
}
