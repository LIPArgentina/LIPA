/* Public Firebase web configuration only; never include service-account credentials. */
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/11.10.0/firebase-messaging-compat.js');
const config=JSON.parse(new URL(self.location.href).searchParams.get('config')||'{}');
firebase.initializeApp(config);
firebase.messaging();
