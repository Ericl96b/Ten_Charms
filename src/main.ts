const app = document.getElementById('app')!;
app.innerHTML = '<div class="screen" data-screen="shell"><h1>Ten Charms</h1></div>';
if ('serviceWorker' in navigator) void navigator.serviceWorker.register('sw.js');
