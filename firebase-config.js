// Firebase is initialized here using the compat SDK, which is loaded via
// <script> tags in index.html. Do NOT use the modular `import` syntax here.
// The API key is safe to commit publicly — security comes from Firestore rules.

const firebaseConfig = {
  apiKey: "AIzaSyCcX1fvxMmpHOtkdgtqq0IH2_23g8zWktU",
  authDomain: "sf-house-hunt.firebaseapp.com",
  projectId: "sf-house-hunt",
  storageBucket: "sf-house-hunt.firebasestorage.app",
  messagingSenderId: "1095612237066",
  appId: "1:1095612237066:web:3f84c590b1065229a166f3"
};

firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();

// Enables offline support + cross-tab sync in the same browser
db.enablePersistence({ synchronizeTabs: true }).catch(() => {});
