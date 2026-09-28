/* Moods - your Firebase project.
   Create one at https://console.firebase.google.com (free Spark plan is fine),
   add a Realtime Database, then paste the web app config here.

   These values are meant to be public - they identify the project, they don't
   grant access. Access is controlled by the database rules in the README. */

export const FIREBASE = {
  apiKey:            "AIzaSyBDQgReck8DpIKCBROHdlJC-GZybO-EKVY",
  authDomain:        "moods-53eed.firebaseapp.com",
  databaseURL:       "https://moods-53eed-default-rtdb.europe-west1.firebasedatabase.app",
  projectId:         "moods-53eed",
  storageBucket:     "moods-53eed.firebasestorage.app",
  messagingSenderId: "784353129100",
  appId:             "1:784353129100:web:12ae1310a65dcbb89841a9",
};

/* Optional. Without it people paste links, which is the main path anyway.
   With it they can also just type a song name.
   Enable "YouTube Data API v3" on the same Google Cloud project, make an API
   key, and restrict it to your GitHub Pages domain. */
export const YOUTUBE_API_KEY = "";

export const configured = () => !!(FIREBASE.apiKey && FIREBASE.databaseURL);
