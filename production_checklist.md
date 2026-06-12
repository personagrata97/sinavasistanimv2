# 🚀 Production (Canlı Ortam) Geçiş Kontrol Listesi

Bu liste, sistemin yerel geliştirme (development) ortamından çıkıp canlı (production) ortama taşınmadan hemen önce uygulanması gereken adımları içermektedir.

## 🔐 1. Güvenlik ve Yetkilendirme (Auth & Roles)
- [ ] **E-posta Onay Sistemi:** Açık kayıt sistemi aktif olacak ancak sahte hesapları engellemek için kullanıcılara kayıt sonrası e-posta doğrulama (email verification) adımı eklenecek.
- [ ] **Yetki Kısıtlamaları (Role-Based Access):** Sisteme dışarıdan kayıt olan kullanıcılar `student` (öğrenci) rolüyle başlayacak. Bu kullanıcıların PDF yükleme (`/upload`) ve `process` işlemlerini tetikleme yetkileri backend API ve UI bazında tamamen kapatılacak. Sadece sizin (Admin) daha önceden yükleyip hazırladığınız notları ve soruları görüntüleyebilecekler.

## 🏗️ 2. Sistem Mimarisi ve Altyapı
- [ ] **Rate Limiter (Kota Koruyucu) Redis Geçişi:** Şu an bellekte (`Map`) tutulan rate-limit sistemi, Vercel/AWS gibi serverless ortamlarda sıfırlanacağı için **Upstash Redis**'e geçirilecek.
- [ ] **Dinamik Dosya Yolları:** Kodun içine yazılmış olan (hardcoded) statik bilgisayar yolları (örn. `/Users/selimkaya/.../bg_error.log`), uygulamanın çalışacağı sunucudaki dizine göre `process.cwd()` kullanılarak dinamik hale getirilecek.

## ⚙️ 3. Çevre Değişkenleri (Environment Variables)
- [ ] **Secret Token:** `process` API'sine yetkisiz dış erişimleri engellemek için kullanılan `"mufettis_onayi"` gibi açık metin şifreler, `.env` dosyasına (`INTERNAL_SECRET_TOKEN`) taşınacak.

---
> **Not:** Bu liste, sizin direktifleriniz doğrultusunda güncellenmeye devam edilebilir bir taslaktır. Canlı ortama çıkmadan önce adım adım bu listedekiler tamamlanacaktır.
