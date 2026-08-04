# BMS 難易度表ダウンローダー

[한국어](README.ko.md) · **日本語** · [English](README.md)

6つのBMS難易度表から表とレベルを選び、BMS Library から曲本体と差分を検索し、順番にダウンロード要求を行う多言語ブックマークレットです。

## かんたんインストール

1. [インストールページ](https://yuupmu.github.io/BMS_starlight_difficulty_downloader/)を開きます。
2. ブックマークバーが隠れている場合は `⌘/Ctrl + Shift + B` を押します。
3. **★ BMS Table Downloader** または **★ Standalone Downloader** をブックマークバーへドラッグします。
4. [BMS Library Songs](https://horieyuuka.github.io/Songs)を開き、追加したブックマークをクリックします。

GitHub の README ではブラウザーのセキュリティ上、`javascript:` ブックマークを直接実行できません。インストールページのボタンをブックマークバーへドラッグする方法が最も簡単です。ローダーがブロックされる場合は **Standalone Downloader** を使用してください。

## 主な機能

- 最初の画面で Starlight、Stardust、Satellite、Stella、NEW GENERATION Normal / Insane を選択。
- 選択した表に実際に存在するレベルと譜面数を表示。
- 右上で 한국어・日本語・English を切り替え。
- BMS Library の Songs と Sabuns の両方を検索。
- 表・レベル別に検索結果を保存し、API を再検索せず復元。中断した検索も続きから再開。
- **未ダウンロード**フィルターと**表示中をすべて選択**による柔軟な一括選択。
- Chrome/Edge では保存先フォルダーを選び、同名ファイルを上書きせず直接保存。
- 固定件数に加えて**サーバー許容量まで（自動）**を選択可能。
- キュー、制限解除時刻、設定、ダウンロード要求履歴をブラウザーに保存。
- ページを閉じたり制限に達した場合も、最初の未処理ファイルから再開。
- 成功した要求を `song:<ファイル ID>` または `sabun:<ファイル ID>` として記録し、重複を防止。
- 履歴画面から **再ダウンロード**、履歴削除、CSV 出力が可能。
- 以前の `starlight-level-downloader:*:v2` キューと設定を自動移行。
- 実行時・ビルド時ともに外部依存パッケージなし。

## ユーザー向けインストール

プロジェクトの [GitHub Pages インストールページ](https://yuupmu.github.io/BMS_starlight_difficulty_downloader/)を開き、**★ BMS Table Downloader** をブラウザーのブックマークバーへドラッグします。その後、[BMS Library Songs](https://horieyuuka.github.io/Songs) を開いてブックマークレットを実行します。

インストーラーには二つの方式があります。

- **Hosted loader:** GitHub Pages 上の最新スクリプトを読み込む短いブックマークレット。
- **Standalone:** 全コードをブックマーク内に含みます。ページのセキュリティポリシーで外部ローダーがブロックされる場合に利用できます。

## GitHub Pages で公開

ビルド済みサイトは `docs/` に含まれています。

1. GitHub リポジトリを作成してこのプロジェクトをアップロードします。
2. **Settings → Pages** を開きます。
3. **Deploy from a branch** を選択します。
4. `main` ブランチと `/docs` フォルダーを選択します。
5. 保存後、公開された Pages URL を開きます。

インストーラーは現在の Pages URL からスクリプトのアドレスを自動生成するため、ユーザー名やリポジトリ名を編集する必要はありません。

## 開発・ビルド

Node.js 20 以上を推奨します。

```bash
npm test
npm run check
npm run build
```

Stardust・Satellite・Stella の公式 JSON スナップショットは `npm run sync:tables` で更新できます。

生成物:

```text
dist/starlight-difficulty-downloader.js
dist/SHA256SUMS.txt
docs/assets/starlight-difficulty-downloader.js
```

生成されたバンドルは直接編集せず、`src/` を編集してから再ビルドしてください。

## 中断再開と重複防止

キューと要求履歴は BMS Library オリジンの `localStorage` に保存されます。

サーバーがダウンロード URL を返すと、ツールはブラウザーへファイルを渡し、ファイル種別と ID を履歴に記録してからキューから削除します。この二つの保存処理の間で実行が止まり同じ項目がキューに残った場合も、次回起動時に履歴キーを確認して自動的に除外します。

差分が別ファイルの譜面では、曲本体と差分の二つが必要な場合があります。進行状況は `1/2 送信済み` のように表示されます。

検索結果も表・レベル別に `localStorage` へ保存されます。**検索**は保存結果を復元し、**再検索**はキャッシュを消して最初から検索します。

## 保存先と自動バッチ

Chrome/Edge の **保存先フォルダーを選択**では、今回の実行で使うフォルダーへ直接保存できます。ブラウザーの安全仕様により完全なローカルパスは表示されず、ページを開き直した後は再選択が必要な場合があります。未対応ブラウザーでは標準のダウンロード先設定を使用します。

**サーバー許容量まで（自動）**はサーバーが返す残数に従い、0 になった時点でキューを保持して停止します。大量処理ではブラウザーの複数ダウンロード許可も必要になるため、対応環境ではフォルダー直接保存を推奨します。

### 重要な制限

**送信済み**は、サーバーが URL を発行し、ツールがファイルをブラウザーへ渡した状態を意味します。ウェブページからブラウザーやディスクで保存が完了したかどうかを確実に確認することはできません。ブラウザー側で失敗した場合は、**ダウンロード履歴**から **再ダウンロード**を選択してください。

## 保存される情報

- 選択した言語、難易度表、表ごとのレベル;
- 1回の処理件数;
- 未処理キュー;
- サーバーが返した残数と解除時刻;
- 要求したファイルの種別、ID、タイトル、レベル、時刻。
- 最近の表・レベル別検索結果（最大8件）。

本プロジェクトは独自サーバーを運用せず、この履歴を外部へ送信しません。

## データ出典

- Starlight: <https://djkuroakari.github.io/starlighttable.html>
- Stardust: <https://mqppppp.neocities.org/ChartView>
- Satellite: <https://stellabms.xyz/sl/table.html>
- Stella: <https://stellabms.xyz/st/table.html>
- NEW GENERATION Normal / Insane: <https://rattoto10.jounin.jp/table.html>
- BMS Library: <https://horieyuuka.github.io/Songs>

本プロジェクトは独立した支援ツールであり、収録難易度表または BMS Library の公式プロジェクトではありません。BMS コンテンツは制作者・配布元の条件に従って利用してください。

## ライセンス

MIT。詳細は [LICENSE](LICENSE) を参照してください。
