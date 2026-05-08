# PickleMatch VN Product Spec

## 1. Product Positioning

PickleMatch VN la ung dung mobile giup cong dong pickleball tai Viet Nam:

- tim keo dung lich, dung san, dung trinh do
- quan ly keo ro rang hon cho host
- giam no-show va giam lech trinh
- tao long tin cong dong bang booking, result confirmation va rating
- giu nguoi dung quay lai bang Elo, streak, badge va achievement

San pham khong chi la noi dang keo, ma la he thong van hanh mot tran pickleball phong trao tu luc tao keo den sau tran.

## 2. Core Value Proposition

### Doi voi player

- tim keo nhanh hon
- thay ro tinh trang san va booking
- tranh vao nham keo lech trinh
- co profile, Elo, streak va danh hieu de theo doi tien bo

### Doi voi host

- tao keo nhanh
- quan ly join request tot hon
- booking san ro rang hon
- co notification khi session thay doi
- co flow nhac dong keo va xac nhan ket qua sau tran

## 3. Product Pillars

### Pillar 1: Matchmaking dung trinh

- self-assessment 5 muc
- starting Elo
- placement mode
- smart join flow
- peer review sau tran

### Pillar 2: Community trust

- hidden rating
- reliability score
- host reputation
- no-show tracking
- result confirmation / dispute

### Pillar 3: Host operation quality

- booking confirmed / unconfirmed
- host approval tools
- session update notifications
- pending completion reminder
- auto-close fallback

### Pillar 4: Progression and retention

- current Elo
- placement progress
- win streak
- achievements
- trophy room

## 4. Main User Flows

### Onboarding

1. Dang nhap
2. Profile setup
3. Skill assessment
4. Vao Home

Neu user chua hoan tat profile hoac chua chon skill, app tu dieu huong den buoc con thieu.

### Session discovery

Nguoi choi tim keo qua:

- Home
- Find Session
- My Sessions

Home va Find Session la discovery surfaces. My Sessions la noi quan ly tat ca keo dang host, dang tham gia va da tham gia.

### Session creation

Host tao keo qua flow nhieu buoc:

1. chon san
2. chon ngay va gio
3. chon so nguoi
4. chon dai trinh do
5. bat / tat approval
6. khai bao booking status
7. review va publish

### Joining a session

Smart join flow hien co 3 trang thai:

- `MATCHED`
- `LOWER_SKILL`
- `WAITLIST`

Tuong ung voi:

- vao thang
- xin vao keo
- dang ky du bi

### Post-match flow

Sau tran, vai tro duoc chot ro:

- host la nguoi nhap ket qua
- player la nguoi confirm hoac dispute
- neu host khong xu ly dung han, he thong auto-close session voi `draw`
- player co the bao host khong chuyen nghiep neu host van hanh kem

Flow hien tai:

1. Session qua gio vao `pending_completion`
2. Host nhan notification nhac dong keo
3. Host gui ket qua
4. Player confirm hoac dispute
5. Neu host khong xu ly qua moc quy dinh, he thong tu dong close session voi `draw`

## 5. Skill Model

App dung 5 muc skill:

1. Moi boc tem
2. Biet dieu bong
3. Chien than co xat
4. Tay vot phong trao
5. Tho san giai thuong

Model nay dung de:

- seed starting Elo
- dua user vao provisional mode
- ho tro matchmaking buoc dau

## 6. Placement and Skill Calibration

### Placement mode

Nguoi choi moi vao app se o trang thai:

- `is_provisional = true`
- `placement_matches_played = 0`

### Peer review

Sau tran, nguoi choi danh gia doi thu:

- `weaker`
- `matched`
- `outclass`

### Placement multiplier

Trong 5 tran placement dau:

- Elo bien dong manh hon
- peer review co trong so lon hon
- he thong co gang dua user nhanh ve dung trinh thuc te

### Label sync

Skill label hien thi tren profile duoc dong bo theo `current_elo`, khong chi dua vao self-assessment ban dau.

## 7. Session Lifecycle

### Main session states

- `open`
- `pending_completion`
- `done`
- `cancelled`

### Result states

- `not_submitted`
- `pending_confirmation`
- `disputed`
- `finalized`
- `void`

### Operational rules

- session qua `end_time + buffer` se vao `pending_completion`
- host duoc nhac dong keo
- neu host submit ket qua, player confirm / dispute
- neu host khong xu ly den moc hard timeout, he thong auto-close voi `draw`

## 8. Booking Logic

Booking la mot trust signal quan trong.

Session co 2 booking states:

- `confirmed`
- `unconfirmed`

Booking info co the gom:

- booking reference
- booking name
- booking phone
- booking notes
- booking confirmed at

Neu san da chot:

- mot so truong trong flow sua keo bi khoa
- feed va card UI uu tien hien thi session chac chan hon

## 9. Community Trust Logic

### Reliability

Nguoi choi co the bi tru reliability boi:

- no-show
- late
- toxic behavior
- dishonest behavior

### Host reputation

Host reputation bi anh huong boi:

- feedback sau tran
- quality cua booking va to chuc
- viec chot ket qua dung han
- bao cao host van hanh kem

Neu host de he thong auto-close session:

- host bi tru nhe uy tin

Neu player bao host khong chuyen nghiep:

- he thong ghi nhan report
- host nhan notification
- host reputation bi tru nhe

## 10. Rating Logic

### Hidden rating

Rating sau tran khong mo ngay lap tuc.

Rating chi duoc reveal khi:

- hai ben da rate lan nhau
- hoac da qua moc reveal

### Rating inputs

Rating hien tai co the tac dong den:

- reliability
- host reputation
- no-show count
- peer review input cho calibration

## 11. Result Confirmation Logic

He thong khong tin hoan toan vao ket qua host nhap.

Rule hien tai:

- host submit proposed results
- player confirm hoac dispute
- chi khi ket qua duoc finalize thi moi tac dong den streak, achievement va calibration
- neu host khong dong keo, fallback cuoi cung la auto `draw`

Muc tieu:

- ngan fake wins
- ngan fake streak
- tranh session treo vo han

## 12. Achievement System

He thong achievement gom 4 nhom:

### Progression

- Hoi vien tich cuc
- Chien than san bai

### Performance

- Giant Slayer
- Tot nghiep xuat sac

### Momentum

- Win Streak

### Conduct

- Dong ho Thuy Si
- Host Vang

## 13. Win Streak Rule

Win streak chi co y nghia neu con "nong".

Neu nguoi choi khong choi qua 14 ngay:

- current streak reset
- fire icon tat

## 14. Key Notifications

Nhung event chinh duoc communicate qua notifications:

- join request
- join approved / rejected
- player left
- session cancelled
- session updated
- result submitted
- result disputed
- session pending completion
- session auto-closed
- host unprofessional reported
- achievement unlocked

## 15. Current Product Scope

San pham hien da co:

- onboarding
- discovery
- create / join / manage session
- booking status
- post-match rating
- Elo calibration
- result confirmation
- achievement system
- trophy room
- post-match lifecycle voi pending completion va auto-close

Hang muc dang hold:

- cron / edge function auto-finalize hidden ratings

Lien quan den:

- `supabase/functions/process-pending-ratings/index.ts`
- `supabase/migrations/20260324_add_pending_ratings_processor.sql`
