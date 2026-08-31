/**
 * おすすめ商品ウィジェット（楽天市場 商品検索APIを利用）
 * - #rakuten-recommend-items 要素を見つけて、そこに商品カードを描画する
  - 楽天APIは fetch() で直接JSON形式のレスポンスを取得する（script src読み込みだと
 *   Rakuten側でリクエストが弾かれるため使用しない）
 * - APIエラーやタイムアウト時は何も表示しない（サイトの見た目を壊さない）
 */
(function () {
    'use strict';

   // ▼▼▼ ここに楽天ウェブサービスで発行したアプリID・アクセスキー・アフィリエイトIDを入れてください ▼▼▼
   var APP_ID = '45f9e500-ebce-4f93-a51e-19dd8372a52c';
    var ACCESS_KEY = 'pk_UWXPUBibFaBHJMmvPtmIMTUIntba0hUxlT7lOIXv49t';
    var AFFILIATE_ID = '56f2dc50.03df62a8.56f2dc51.4ffb6a08';
    // ▲▲▲ ここまで ▲▲▲

   // 表示したい商品ジャンル（検索キーワード）とキーワードごとの表示件数
   var KEYWORDS = ['ゲーミングマウス', 'ゲーミングキーボード'];
    var HITS_PER_KEYWORD = 3;

   // 新API（2026年仕様）のエンドポイント。旧 app.rakuten.co.jp/services/api は
   // 2026年5月13日で廃止されたため openapi.rakuten.co.jp を使用する。
   var API_ENDPOINT = 'https://openapi.rakuten.co.jp/ichibams/api/IchibaItem/Search/20260701';
    var REQUEST_TIMEOUT_MS = 8000;

   function buildUrl(keyword) {
         var params = {
                 applicationId: APP_ID,
                 accessKey: ACCESS_KEY,
                 affiliateId: AFFILIATE_ID,
                 keyword: keyword,
                 hits: HITS_PER_KEYWORD,
                 imageFlag: 1,
                 formatVersion: 2,
                 format: 'json'
         };
         var qs = Object.keys(params)
           .filter(function (k) { return params[k] !== '' && params[k] != null; })
           .map(function (k) { return encodeURIComponent(k) + '=' + encodeURIComponent(params[k]); })
           .join('&');
         return API_ENDPOINT + '?' + qs;
   }

   function fetchJson(url) {
         var controller = (typeof AbortController !== 'undefined') ? new AbortController() : null;
         var timer = setTimeout(function () {
                 if (controller) controller.abort();
         }, REQUEST_TIMEOUT_MS);

         return fetch(url, { method: 'GET', mode: 'cors', signal: controller ? controller.signal : undefined })
           .then(function (res) {
                     if (!res.ok) throw new Error('rakuten-recommend: HTTP ' + res.status);
                     return res.json();
           })
           .then(function (data) {
                     clearTimeout(timer);
                     return data;
           }, function (err) {
                     clearTimeout(timer);
                     throw err;
           });
   }

   function escapeHtml(str) {
         return String(str).replace(/[&<>"']/g, function (c) {
                 return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
         });
   }

   function formatPrice(n) {
         var num = Number(n);
         if (!isFinite(num)) return '';
         return '¥' + num.toLocaleString('ja-JP');
   }

   // mediumImageUrls の要素は formatVersion によって
   // 文字列 "https://..." の場合と {imageUrl:"https://..."} の場合があるため両方に対応する
   function pickImageUrl(imageEntry) {
         if (!imageEntry) return '';
         var url = typeof imageEntry === 'string' ? imageEntry : imageEntry.imageUrl;
         if (!url) return '';
         return url.replace(/^http:\/\//, 'https://');
   }

   function shuffle(list) {
         for (var i = list.length - 1; i > 0; i--) {
                 var j = Math.floor(Math.random() * (i + 1));
                 var tmp = list[i];
                 list[i] = list[j];
                 list[j] = tmp;
         }
         return list;
   }

   function normalizeItems(apiResponse) {
         if (!apiResponse) return [];
         var rawItems = apiResponse.items || apiResponse.Items || [];
         return rawItems
           .map(function (entry) {
                     // formatVersion=1 は {Item:{...}} でラップされる場合があるための保険
                        return entry && (entry.Item || entry.item || entry);
           })
           .filter(Boolean);
   }

   function renderItems(items) {
         var container = document.getElementById('rakuten-recommend-items');
         if (!container || !items.length) return;

      var cardsHtml = items
           .map(function (item) {
                     var name = item.itemName || '';
                     var image = pickImageUrl(item.mediumImageUrls && item.mediumImageUrls[0]);
                     var price = item.itemPrice;
                     var url = item.affiliateUrl || item.itemUrl;
                     if (!url || !image || !name) return '';

                        var shortName = name.length > 42 ? name.slice(0, 42) + '…' : name;

                        return (
                                    '<a class="rakuten-recommend-item" href="' + escapeHtml(url) + '" target="_blank" rel="nofollow sponsored noopener">' +
                                    '<span class="rakuten-recommend-pr">PR</span>' +
                                    '<span class="rakuten-recommend-thumb"><img src="' + escapeHtml(image) + '" alt="" loading="lazy" width="140" height="140"></span>' +
                                    '<span class="rakuten-recommend-name">' + escapeHtml(shortName) + '</span>' +
                                    (price ? '<span class="rakuten-recommend-price">' + escapeHtml(formatPrice(price)) + '</span>' : '') +
                                    '<span class="rakuten-recommend-cta">楽天で見る →</span>' +
                                    '</a>'
                                  );
           })
           .filter(Boolean)
           .join('');

      if (!cardsHtml) return;

      container.innerHTML =
              '<div class="rakuten-recommend">' +
              '<p class="rakuten-recommend-label">その他のおすすめ商品</p>' +
              '<div class="rakuten-recommend-grid">' + cardsHtml + '</div>' +
              '</div>';
   }

   function init() {
         var container = document.getElementById('rakuten-recommend-items');
         if (!container || !APP_ID || APP_ID.indexOf('PASTE_') === 0) return;

              // 楽天APIの予想QPSは1リクエスト/秒のため、キーワードごとに閘をあけて順番にリクエストする
        var allItems = [];

        function fetchNext(idx) {
            if (idx >= KEYWORDS.length) {
                renderItems(shuffle(allItems));
                return;
            }
            fetchJson(buildUrl(KEYWORDS[idx]))
                .then(function (res) {
                    allItems = allItems.concat(normalizeItems(res));
                })
                .catch(function () {
                    // 1件失敗しても他のキーワードの結果は使う
                })
                .then(function () {
                    setTimeout(function () { fetchNext(idx + 1); }, 1100);
                });
        }

        fetchNext(0);
   }

   if (document.readyState === 'loading') {
         document.addEventListener('DOMContentLoaded', init);
   } else {
         init();
   }
})();
