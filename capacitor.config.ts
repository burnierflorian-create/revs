import type { CapacitorConfig } from '@capacitor/cli'

// Configuration Capacitor — enveloppe native du build web de REVS.
//
// PRINCIPE : Capacitor n'embarque pas un second projet. Il empaquette le
// contenu de `dist/` tel quel dans une WebView. Le code React n'est ni
// modifié ni recompilé différemment : `npm run build` produit exactement le
// même bundle pour le web et pour les stores.
//
// Voir CAPACITOR.md pour la procédure complète, et surtout pour les deux
// points qui ne sont PAS résolus par ce fichier (service worker sur iOS,
// notifications push natives).
const config: CapacitorConfig = {
  appId: 'app.revs.carspotting',
  appName: 'REVS',
  webDir: 'dist',

  server: {
    // Android sert la WebView en https://localhost. C'est délibéré et il ne
    // faut pas le repasser en `http` : un contexte non sécurisé désactive à
    // la fois le service worker et l'API Geolocation, dont REVS dépend.
    androidScheme: 'https',
  },

  plugins: {
    // ── Écran de lancement ──
    // Fond identique à --color-bg (#0a0a0a) pour qu'il n'y ait pas de flash
    // clair entre le splash natif et la première frame de React.
    SplashScreen: {
      launchShowDuration: 1500,
      launchAutoHide: true,
      backgroundColor: '#0a0a0a',
      androidScaleType: 'CENTER_CROP',
      showSpinner: false,
      splashFullScreen: true,
      splashImmersive: true,
    },

    // ── Barre de statut ──
    // `DARK` signifie « contenu clair sur fond sombre » dans l'API Capacitor
    // (c'est contre-intuitif, mais c'est bien ce sens-là).
    //
    // LIMITE CONNUE : cette valeur est STATIQUE. REVS a un thème clair
    // (html.light) ; quand l'utilisateur y bascule, la barre de statut
    // gardera du texte clair sur fond sombre et deviendra peu lisible. La
    // corriger demande un appel à StatusBar.setStyle() dans le
    // ThemeProvider — donc une modification du code React, explicitement
    // hors périmètre pour cette étape. À traiter avant la bêta publique.
    StatusBar: {
      style: 'DARK',
      backgroundColor: '#0a0a0a',
      overlaysWebView: false,
    },

    // ── Notifications push ──
    // ATTENTION : installer ce plugin ne rend PAS les push fonctionnels.
    // REVS envoie aujourd'hui des push Web (VAPID / web-push) vers des
    // endpoints navigateur. En natif, ce plugin passe par FCM (Android) et
    // APNs (iOS) : ce sont d'autres transports, d'autres jetons, d'autres
    // identifiants côté serveur. Détail de ce qu'il reste à faire dans
    // CAPACITOR.md § « Push ».
    PushNotifications: {
      presentationOptions: ['badge', 'sound', 'alert'],
    },
  },
}

export default config
