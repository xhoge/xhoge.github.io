# GitHub Pages 公開用ファイル

このフォルダの中身をリポジトリの公開元へ配置してください。

```text
index.html          トップページ
.nojekyll           静的ファイルとして公開
dialStudio/         Dial Studioをこのフォルダだけで管理
  index.html        アプリ入口
  connection-test.html  以前のファイル名でも開ける入口
  studio.css
  *.mjs
  vendor/
```

トップページのリンクは相対パスです。リポジトリ名によるサブパスでも利用できます。アプリ更新時はdialStudio/以下を差し替えます。トップのindex.htmlはアプリとは独立しています。

既にGitHubにリポジトリがある場合は、Settings → Pagesで公開元のブランチとフォルダを指定します。この一式をルートに置く場合はmain / (root)などを選びます。公開の実行はユーザー側で行ってください。
