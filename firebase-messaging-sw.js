importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.2/firebase-messaging-compat.js');
firebase.initializeApp({
  apiKey: "AIzaSyD56bAmRZdJ1WRiGPIo7LDc8ri7JFeM7KI",
  authDomain: "mis-horas-ana-paola.firebaseapp.com",
  projectId: "mis-horas-ana-paola",
  storageBucket: "mis-horas-ana-paola.firebasestorage.app",
  messagingSenderId: "981558333028",
  appId: "1:981558333028:web:c5cacbdebf8654c43a9971"
});
firebase.messaging();
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({type: 'window', includeUncontrolled: true}).then(list => {
    for (const c of list) { if ('focus' in c) return c.focus(); }
    return clients.openWindow('./');
  }));
});
