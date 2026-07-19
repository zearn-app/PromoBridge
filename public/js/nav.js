import { api } from './api.js';

const ICONS = {
  home: '<path d="M3 11.5 12 4l9 7.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 10v9a1 1 0 0 0 1 1h4v-6h4v6h4a1 1 0 0 0 1-1v-9" stroke-linecap="round" stroke-linejoin="round"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3" stroke-linecap="round"/>',
  orders: '<rect x="4" y="6" width="16" height="14" rx="2"/><path d="M8 6V5a4 4 0 0 1 8 0v1" stroke-linecap="round"/>',
  messages: '<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-5 4V6a1 1 0 0 1 1-1Z" stroke-linejoin="round"/>',
  notifications: '<path d="M6 10a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5H4.5S6 14 6 10Z" stroke-linejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke-linecap="round"/>',
  profile: '<circle cx="12" cy="8" r="4"/><path d="M4 20c0-3.5 3.5-6 8-6s8 2.5 8 6" stroke-linecap="round"/>',
};

const ITEMS = [
  { key: 'home', label: 'Home', href: '/pages/home.html' },
  { key: 'search', label: 'Search', href: '/pages/search.html' },
  { key: 'orders', label: 'Orders', href: '/pages/orders.html' },
  { key: 'messages', label: 'Messages', href: '/pages/messages.html' },
  { key: 'notifications', label: 'Alerts', href: '/pages/notifications.html' },
  { key: 'profile', label: 'Profile', href: '/pages/profile.html' },
];

function icon(key) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">${ICONS[key]}</svg>`;
}

/**
 * Renders the fixed bottom navigation bar (Home / Search / Orders /
 * Messages / Alerts / Profile), highlights the active tab, and shows
 * unread badges on Messages and Notifications. Call once per page,
 * after the user is confirmed logged in.
 */
export async function renderNav(activeKey) {
  const nav = document.createElement('nav');
  nav.className = 'bottom-nav';
  nav.innerHTML = ITEMS.map((item) => `
    <a href="${item.href}" class="bottom-nav-item ${item.key === activeKey ? 'active' : ''}" data-nav-key="${item.key}">
      ${icon(item.key)}
      <span>${item.label}</span>
    </a>
  `).join('');
  document.body.appendChild(nav);
  document.body.classList.add('has-bottom-nav');

  try {
    const [{ conversations }, { notifications }] = await Promise.all([
      api('/messages/conversations'),
      api('/notifications/mine'),
    ]);
    const unreadMessages = conversations.reduce((s, c) => s + c.unread, 0);
    const unreadNotifs = notifications.filter((n) => !n.read).length;

    if (unreadMessages > 0) addDot('messages');
    if (unreadNotifs > 0) addDot('notifications');
  } catch (err) {
    // Badge counts are a nice-to-have; never block the page over this.
    console.warn('Nav badge fetch failed:', err.message);
  }

  function addDot(key) {
    const el = nav.querySelector(`[data-nav-key="${key}"]`);
    if (el && !el.querySelector('.nav-dot')) {
      const dot = document.createElement('span');
      dot.className = 'nav-dot';
      el.appendChild(dot);
    }
  }
}
