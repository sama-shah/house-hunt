// Copy this file to firebase-config.js and fill in your values.
// firebase-config.js is gitignored — never commit it.
// For deployment, store the full content of firebase-config.js
// as a GitHub Secret named FIREBASE_CONFIG_JS (see .github/workflows/deploy.yml).

const firebaseConfig = {
  apiKey: "YOUR_API_KEY",
  authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
  projectId: "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId: "YOUR_APP_ID"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
