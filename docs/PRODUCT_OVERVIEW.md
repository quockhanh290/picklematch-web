# PickleMatch VN Product Overview

## 1. Product Summary

PickleMatch VN la ung dung mobile giup cong dong pickleball tai Viet Nam:

- tim keo dung lich, dung san, dung trinh do
- tao va van hanh keo de hon cho host
- giam no-show va giam lech trinh
- xay dung long tin cong dong bang rating, xac nhan ket qua va uy tin
- tao dong luc quay lai bang Elo, streak, badge va achievement

Ung dung duoc xay dung theo huong "community matchmaking + trust layer + gamification layer", khong chi la mot bang tin dang keo don thuan.

## 2. Core Problem

Nguoi choi pickleball phong trao thuong gap 4 van de:

- kho tim keo phu hop lich va trinh do
- kho biet keo nao chac chan da dat san
- host van hanh thieu dong bo, de xay ra treo keo hoac vo keo phut cuoi
- ket qua sau tran, rating va do tin cay khong duoc ghi nhan ro rang

PickleMatch VN giai quyet nhung diem do bang mot he thong co cau truc:

- ho so nguoi choi
- matching theo trinh do
- booking status
- join flow linh hoat
- result confirmation
- post-match rating
- progression va reputation

## 3. Target Users

### Player

Player dung app de:

- tao ho so
- tu danh gia trinh do ban dau
- tim keo phu hop
- xin vao keo, vao thang hoac dang ky du bi
- xem host va tinh trang booking
- danh gia sau tran
- theo doi Elo, streak, badge va lich su choi

### Host

Host dung app de:

- tao keo nhanh
- khai bao san va booking
- duyet nguoi choi neu can
- chinh sua keo
- nhac va dong keo sau tran
- gui ket qua tran de nguoi choi xac nhan

## 4. Product Pillars

### 4.1 Matchmaking dung trinh

- onboarding co self-assessment 5 muc
- moi muc map sang Elo khoi diem
- co placement mode cho nguoi choi moi
- co peer review sau tran de calibration lai trinh do

### 4.2 Community trust

- rating sau tran theo che do hidden
- confirmation/dispute ket qua
- reliability score
- host reputation
- no-show tracking

### 4.3 Host operation quality

- booking confirmed/unconfirmed
- quick review join requests
- notification khi keo thay doi
- reminder khi host cham dong keo
- player co the bao host khong chuyen nghiep neu host khong chot keo dung han

### 4.4 Progression va retention

- current Elo
- placement progress
- win streak
- achievement system
- trophy room

## 5. Main Product Flows

### 5.1 Onboarding

Luong chinh:

1. Dang nhap
2. Profile setup
3. Skill assessment
4. Vao Home

Neu user chua hoan tat ho so hoac chua co self-assessment, app tu dieu huong den buoc con thieu.

### 5.2 Session discovery

Nguoi choi co 3 diem vao chinh:

- Home
- Find Session
- My Sessions

Home va Find Session giup tim keo, con My Sessions giup quan ly cac keo dang host, dang tham gia va da tham gia.

### 5.3 Session creation

Host tao keo theo flow nhieu buoc:

1. chon san
2. chon ngay va gio
3. chon so nguoi
4. chon dai trinh do
5. bat/tat approval
6. khai bao booking status
7. review va publish

### 5.4 Joining a session

Smart join flow hien co 3 trang thai:

- `MATCHED`
- `LOWER_SKILL`
- `WAITLIST`

Tuong ung voi:

- vao thang
- xin vao keo
- dang ky du bi

### 5.5 Post-match flow

Sau tran, he thong uu tien giu vai tro ro rang:

- host la nguoi nhap ket qua
- player la nguoi xac nhan hoac dispute
- neu host khong dong keo dung han, he thong tu close voi ket qua `draw`
- player co the bao host khong chuyen nghiep neu host van hanh kem

Flow hien tai:

1. Session qua gio se vao `pending_completion`
2. Host nhan notification nhac dong keo
3. Host gui ket qua tran
4. Player xac nhan hoac dispute
5. Neu host khong xu ly sau moc thoi gian quy dinh, he thong auto-close session voi `draw`

## 6. Skill and Elo System

### 6.1 Five-level skill model

App dung 5 muc tu danh gia:

1. Moi boc tem
2. Biet dieu bong
3. Chien than co xat
4. Tay vot phong trao
5. Tho san giai thuong

### 6.2 Placement mode

Nguoi choi moi duoc dua vao provisional mode:

- `is_provisional = true`
- `placement_matches_played = 0`

Trong 5 tran dau:

- Elo bien dong manh hon
- peer review duoc tinh nang hon
- he thong co gang dua user nhanh ve dung trinh thuc te

### 6.3 Skill calibration

Calibration hien tai dua tren:

- ket qua tran
- peer review sau tran: `weaker`, `matched`, `outclass`
- placement multiplier trong 5 tran dau

Sau du 5 tran placement hop le:

- `is_provisional` tu tat
- nhan trinh do hien thi uu tien dong bo theo Elo hien tai

## 7. Trust and Reputation

### 7.1 Reliability score

Player bat dau voi muc trust cao va co the bi tru boi:

- no-show
- late
- toxic behavior
- dishonest behavior trong rating

### 7.2 Host reputation

Host reputation bi anh huong boi:

- feedback sau tran
- chat luong to chuc
- mo ta dung/thieu chinh xac
- viec chot keo va van hanh sau tran

Neu host de he thong phai tu dong dong keo:

- session bi auto-close
- host bi tru nhe uy tin

Neu player bao host khong chuyen nghiep:

- he thong ghi nhan report
- host nhan notification
- host reputation bi tru nhe

## 8. Rating and Result Confirmation

### 8.1 Hidden ratings

Rating sau tran khong mo ngay lap tuc.

Chung chi duoc reveal khi:

- hai ben da danh gia lan nhau
- hoac da qua moc reveal time

### 8.2 Result confirmation

Ket qua tran chi tro thanh chinh thuc khi:

- host da submit
- player da confirm
- hoac he thong auto-close theo fallback an toan

Muc tieu la tranh:

- host nhap lao ket qua
- session treo vo thoi han
- Elo va achievement bi tinh sai

## 9. Achievement and Progression

He thong achievement hien tai gom 4 nhom:

- progression
- performance
- momentum
- conduct

Vi du:

- Hoi vien tich cuc
- Chien than san bai
- Giant Slayer
- Tot nghiep xuat sac
- Win Streak
- Dong ho Thuy Si
- Host Vang

Ngoai ra, app con co:

- streak decay sau 14 ngay khong choi
- trophy room tren profile
- notification khi mo khoa danh hieu moi

## 10. Current Product Status

San pham hien da co cac lop logic quan trong:

- onboarding va profile
- create/join/manage session
- booking confirmation
- post-match rating
- Elo calibration
- result confirmation
- achievement system
- auto-close lifecycle

Mot hang muc van dang tam hold:

- cron / edge function auto-finalize hidden ratings

Lien quan den:

- `supabase/functions/process-pending-ratings/index.ts`
- `supabase/migrations/20260324_add_pending_ratings_processor.sql`

## 11. Product Direction

Dinh huong hien tai cua PickleMatch VN la:

- giam ma sat trong viec tim keo va host van hanh keo
- tang trust bang booking, ket qua va rating co cau truc
- dua nguoi choi ve dung trinh qua Elo calibration
- giu user bang progression va identity trong cong dong

Noi ngan gon:

PickleMatch VN khong chi la noi "dang keo", ma la he thong van hanh tran dau pickleball phong trao tu dau den cuoi.
