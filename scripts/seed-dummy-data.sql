begin;
create extension if not exists pgcrypto;

create temporary table seed_users (
  user_key text primary key,
  id uuid,
  email text,
  phone text,
  name text,
  city text,
  level text,
  skill_label text,
  elo int,
  current_elo int,
  auto_accept boolean,
  is_provisional boolean,
  placement_matches_played int,
  sessions_joined int,
  no_show_count int,
  reliability_score int,
  host_reputation int,
  earned_badges text[]
) on commit drop;

insert into seed_users values
('host_confirmed','90000000-0000-0000-0000-000000000001','host.confirmed@picklematch.vn','+84990000001','Minh Tú','Hồ Chí Minh','level_4','intermediate',1300,1315,true,false,5,18,0,98,28,array['Friendly','On-time','Great Host']),
('host_approval','90000000-0000-0000-0000-000000000002','host.approval@picklematch.vn','+84990000002','Thu Trang','Hồ Chí Minh','level_3','intermediate',1150,1165,false,false,5,12,1,92,15,array['Friendly']),
('matched_player','90000000-0000-0000-0000-000000000003','player.matched@picklematch.vn','+84990000003','Kevin','Hồ Chí Minh','level_4','intermediate',1300,1285,false,false,5,10,0,96,0,array['Fair Play']),
('lower_skill','90000000-0000-0000-0000-000000000004','player.lower@picklematch.vn','+84990000004','Bảo Ngọc','Hồ Chí Minh','level_2','basic',1000,1020,false,false,5,7,1,88,0,array[]::text[]),
('provisional_host','90000000-0000-0000-0000-000000000006','host.provisional@picklematch.vn','+84990000006','Phương Linh','Hồ Chí Minh','level_2','basic',1000,1000,false,true,2,4,0,100,4,array[]::text[]),
('social_player','90000000-0000-0000-0000-000000000007','player.social@picklematch.vn','+84990000007','Hoàng Nam','Hồ Chí Minh','level_3','intermediate',1150,1175,false,false,5,9,0,95,0,array['Friendly']);

insert into auth.users (instance_id,id,aud,role,email,encrypted_password,email_confirmed_at,phone,phone_confirmed_at,confirmation_token,email_change,email_change_token_new,recovery_token,raw_app_meta_data,raw_user_meta_data,is_sso_user,created_at,updated_at)
select '00000000-0000-0000-0000-000000000000',id,'authenticated','authenticated',email,crypt('Pickle123!', gen_salt('bf')),now(),phone,now(),'','','', '',jsonb_build_object('provider','email','providers',array['email']),jsonb_build_object('name',name,'seed','picklematch-dummy'),false,now(),now()
from seed_users
on conflict (id) do update set email=excluded.email,phone=excluded.phone,encrypted_password=excluded.encrypted_password,raw_user_meta_data=excluded.raw_user_meta_data,updated_at=now();

insert into auth.identities (id,user_id,identity_data,provider,provider_id,created_at,updated_at,last_sign_in_at)
select gen_random_uuid(),id,jsonb_build_object('sub',id::text,'email',email,'email_verified',true),'email',email,now(),now(),now()
from seed_users u
where not exists (select 1 from auth.identities i where i.provider='email' and i.provider_id=u.email);

delete from public.player_achievements where player_id in (select id from seed_users);
delete from public.player_stats where player_id in (select id from seed_users);
delete from public.ratings where session_id in ('55555555-5555-5555-5555-555555555551','55555555-5555-5555-5555-555555555552','55555555-5555-5555-5555-555555555557','55555555-5555-5555-5555-555555555558','55555555-5555-5555-5555-555555555559','55555555-5555-5555-5555-555555555562');
delete from public.notifications where player_id in (select id from seed_users);
delete from public.join_requests where match_id in ('55555555-5555-5555-5555-555555555551','55555555-5555-5555-5555-555555555552');
delete from public.session_players where session_id in ('55555555-5555-5555-5555-555555555551','55555555-5555-5555-5555-555555555552','55555555-5555-5555-5555-555555555557','55555555-5555-5555-5555-555555555558','55555555-5555-5555-5555-555555555559','55555555-5555-5555-5555-555555555562');
delete from public.sessions where id in ('55555555-5555-5555-5555-555555555551','55555555-5555-5555-5555-555555555552','55555555-5555-5555-5555-555555555557','55555555-5555-5555-5555-555555555558','55555555-5555-5555-5555-555555555559','55555555-5555-5555-5555-555555555562');
delete from public.court_slots where id in ('44444444-4444-4444-4444-444444444441','44444444-4444-4444-4444-444444444442','44444444-4444-4444-4444-444444444447','44444444-4444-4444-4444-444444444448','44444444-4444-4444-4444-444444444449','44444444-4444-4444-4444-444444444452');
delete from public.courts where id in ('11111111-1111-1111-1111-111111111111','22222222-2222-2222-2222-222222222222','33333333-3333-3333-3333-333333333333');
delete from public.players where id in (select id from seed_users);

insert into public.players (id,phone,name,city,skill_label,self_assessed_level,elo,current_elo,auto_accept,is_provisional,placement_matches_played,sessions_joined,no_show_count,reliability_score,host_reputation,earned_badges,favorite_court_ids)
select id,phone,name,city,skill_label,level,elo,current_elo,auto_accept,is_provisional,placement_matches_played,sessions_joined,no_show_count,reliability_score,host_reputation,earned_badges,array['11111111-1111-1111-1111-111111111111'::uuid,'22222222-2222-2222-2222-222222222222'::uuid]
from seed_users;

insert into public.player_stats (player_id,total_matches,total_wins,current_win_streak,max_win_streak,last_match_at,streak_fire_active,streak_fire_level,host_average_rating) values
('90000000-0000-0000-0000-000000000001',24,16,3,6,now()-interval '1 day',true,1,4.92),
('90000000-0000-0000-0000-000000000003',14,9,2,4,now()-interval '1 day',false,0,0),
('90000000-0000-0000-0000-000000000006',4,2,1,2,now()-interval '1 day',false,0,3.8);

insert into public.player_achievements (player_id,badge_key,badge_title,badge_category,badge_description,icon,earned_at,meta) values
('90000000-0000-0000-0000-000000000001','active_member_20','Hội viên tích cực','progression','Hoàn thành 20 trận pickleball trên PickleMatch.','medal',now()-interval '10 day','{"source":"sql-seed"}'),
('90000000-0000-0000-0000-000000000001','golden_host','Host Vàng','conduct','Giữ điểm host trung bình từ 4.9 trở lên.','shield',now()-interval '4 day','{"source":"sql-seed"}'),
('90000000-0000-0000-0000-000000000003','giant_slayer','Giant Slayer','performance','Thắng một kèo có ngưỡng trình cao hơn bạn ít nhất 100 Elo.','swords',now()-interval '6 day','{"source":"sql-seed"}'),
('90000000-0000-0000-0000-000000000003','win_streak_3','Win Streak','momentum','Đạt chuỗi thắng 3 trận liên tiếp.','flame',now()-interval '2 day','{"source":"sql-seed"}');

insert into public.courts (id,name,name_en,address,city,district,lat,lng,price_per_hour,num_courts,rating,rating_count,phone,hours_open,hours_close,hours_note,court_type,surface,price_min,price_max,price_note,highlight,tags,google_maps_url,booking_url,created_at) values
('11111111-1111-1111-1111-111111111111','Sân Pickleball Tân Bình','Tan Binh Pickleball','123 Hoàng Văn Thụ','Hồ Chí Minh','Tân Bình',10.801,106.658,240000,4,4.7,48,'0901111111','06:00','22:00','Mở cả tuần','indoor','hard',180000,260000,'Giờ cao điểm cuối tuần tăng giá','Sân sáng, có chỗ gửi xe',array['indoor','central','busy'],'https://maps.google.com/?q=123+Hoang+Van+Thu','https://example.com/booking/tan-binh',now()),
('22222222-2222-2222-2222-222222222222','Sân Pickleball Vạn Phúc','Van Phuc Pickleball','Khu đô thị Vạn Phúc','Hồ Chí Minh','Thủ Đức',10.845,106.706,200000,6,4.5,31,'0902222222','06:00','23:00','Có khu cafe','outdoor','hard',150000,220000,'Giá ổn định','Nhiều sân, dễ ghép đội',array['outdoor','social'],'https://maps.google.com/?q=Van+Phuc+City','https://example.com/booking/van-phuc',now()),
('33333333-3333-3333-3333-333333333333','Sân Pickleball Thảo Điền','Thao Dien Pickleball','88 Xuân Thủy','Hồ Chí Minh','Thảo Điền',10.806,106.736,280000,2,4.9,19,'0903333333','07:00','22:00','Sân đẹp, ít slot','indoor','acrylic',250000,320000,'Premium court','Phù hợp kèo trình cao',array['premium','indoor'],'https://maps.google.com/?q=88+Xuan+Thuy','https://example.com/booking/thao-dien',now());

insert into public.court_slots (id,court_id,start_time,end_time,price,status) values
('44444444-4444-4444-4444-444444444441','11111111-1111-1111-1111-111111111111',date_trunc('day',now())+interval '1 day 18 hour',date_trunc('day',now())+interval '1 day 20 hour',120000,'booked'),
('44444444-4444-4444-4444-444444444442','22222222-2222-2222-2222-222222222222',date_trunc('day',now())+interval '2 day 19 hour',date_trunc('day',now())+interval '2 day 21 hour',100000,'booked'),
('44444444-4444-4444-4444-444444444447','33333333-3333-3333-3333-333333333333',date_trunc('day',now())-interval '7 day'+interval '19 hour',date_trunc('day',now())-interval '7 day'+interval '21 hour',150000,'booked'),
('44444444-4444-4444-4444-444444444448','22222222-2222-2222-2222-222222222222',date_trunc('day',now())-interval '1 day'+interval '21 hour',date_trunc('day',now())-interval '1 day'+interval '22 hour 30 minute',105000,'booked'),
('44444444-4444-4444-4444-444444444449','33333333-3333-3333-3333-333333333333',date_trunc('day',now())-interval '2 day'+interval '18 hour',date_trunc('day',now())-interval '2 day'+interval '20 hour',165000,'booked'),
('44444444-4444-4444-4444-444444444452','11111111-1111-1111-1111-111111111111',date_trunc('day',now())-interval '4 day'+interval '18 hour 30 minute',date_trunc('day',now())-interval '4 day'+interval '20 hour',130000,'booked');

insert into public.sessions (id,host_id,slot_id,elo_min,elo_max,max_players,status,require_approval,fill_deadline,total_cost,court_fee_total,cost_per_player,start_time,end_time,court_id,session_date,court_booking_status,booking_reference,booking_name,booking_phone,booking_notes,booking_confirmed_at,was_full_when_cancelled,results_status,results_submitted_at,results_confirmation_deadline,ghost_session_reported_at,finalized_by) values
('55555555-5555-5555-5555-555555555551','90000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444441',1150,1400,4,'open',false,date_trunc('day',now())+interval '1 day 15 hour',480000,480000,120000,date_trunc('day',now())+interval '1 day 18 hour',date_trunc('day',now())+interval '1 day 20 hour','11111111-1111-1111-1111-111111111111',(date_trunc('day',now())+interval '1 day 18 hour')::date,'confirmed','TB-BOOK-001','Minh Tú','+84901111111','Đã cọc sân',now(),false,'not_submitted',null,null,null,null),
('55555555-5555-5555-5555-555555555552','90000000-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444442',1150,1300,4,'open',true,date_trunc('day',now())+interval '2 day 13 hour',400000,400000,100000,date_trunc('day',now())+interval '2 day 19 hour',date_trunc('day',now())+interval '2 day 21 hour','22222222-2222-2222-2222-222222222222',(date_trunc('day',now())+interval '2 day 19 hour')::date,'unconfirmed',null,null,null,null,null,false,'not_submitted',null,null,null,null),
('55555555-5555-5555-5555-555555555557','90000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444447',1200,1500,4,'done',false,date_trunc('day',now())-interval '7 day'+interval '14 hour',600000,600000,150000,date_trunc('day',now())-interval '7 day'+interval '19 hour',date_trunc('day',now())-interval '7 day'+interval '21 hour','33333333-3333-3333-3333-333333333333',(date_trunc('day',now())-interval '7 day'+interval '19 hour')::date,'confirmed','TD-BOOK-006','Minh Tú','+84901111111','Kèo cũ để seed review profile',now()-interval '8 day',false,'finalized',null,null,null,null),
('55555555-5555-5555-5555-555555555558','90000000-0000-0000-0000-000000000002','44444444-4444-4444-4444-444444444448',1100,1300,4,'done',false,date_trunc('day',now())-interval '1 day'+interval '17 hour',420000,420000,105000,date_trunc('day',now())-interval '1 day'+interval '21 hour',date_trunc('day',now())-interval '1 day'+interval '22 hour 30 minute','22222222-2222-2222-2222-222222222222',(date_trunc('day',now())-interval '1 day'+interval '21 hour')::date,'confirmed','VP-BOOK-007','Thu Trang','+84902222222','Host đã gửi kết quả, đang chờ xác nhận.',now()-interval '2 day',false,'pending_confirmation',now()-interval '1 day'+interval '23 hour',now()+interval '1 day'+interval '23 hour',null,null),
('55555555-5555-5555-5555-555555555559','90000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444449',1200,1450,4,'done',false,date_trunc('day',now())-interval '2 day'+interval '14 hour',660000,660000,165000,date_trunc('day',now())-interval '2 day'+interval '18 hour',date_trunc('day',now())-interval '2 day'+interval '20 hour','33333333-3333-3333-3333-333333333333',(date_trunc('day',now())-interval '2 day'+interval '18 hour')::date,'confirmed','TD-BOOK-008','Minh Tú','+84901111111','Đang có player dispute kết quả.',now()-interval '3 day',false,'disputed',now()-interval '2 day'+interval '21 hour',now()+interval '21 hour',null,null),
('55555555-5555-5555-5555-555555555562','90000000-0000-0000-0000-000000000001','44444444-4444-4444-4444-444444444452',950,1200,4,'cancelled',false,date_trunc('day',now())-interval '4 day'+interval '14 hour',520000,520000,130000,date_trunc('day',now())-interval '4 day'+interval '18 hour 30 minute',date_trunc('day',now())-interval '4 day'+interval '20 hour','11111111-1111-1111-1111-111111111111',(date_trunc('day',now())-interval '4 day'+interval '18 hour 30 minute')::date,'confirmed','TB-BOOK-011','Minh Tú','+84901111111','Người chơi báo trận không diễn ra.',now()-interval '5 day',false,'void',now()-interval '4 day'+interval '21 hour',now()-interval '4 day'+interval '21 hour',now()-interval '4 day'+interval '22 hour','players');

insert into public.session_players (session_id,player_id,status,proposed_result,match_result,result_confirmation_status,result_confirmed_at,result_disputed_at,result_dispute_note,member_reported_result,member_reported_at,member_report_note) values
('55555555-5555-5555-5555-555555555551','90000000-0000-0000-0000-000000000001','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555551','90000000-0000-0000-0000-000000000003','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555552','90000000-0000-0000-0000-000000000002','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555552','90000000-0000-0000-0000-000000000007','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555557','90000000-0000-0000-0000-000000000001','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555557','90000000-0000-0000-0000-000000000003','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555557','90000000-0000-0000-0000-000000000004','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555558','90000000-0000-0000-0000-000000000002','confirmed','win','pending','confirmed',now()-interval '1 day'+interval '23 hour',null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555558','90000000-0000-0000-0000-000000000003','confirmed','loss','pending','awaiting_player',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555558','90000000-0000-0000-0000-000000000007','confirmed','loss','pending','confirmed',now()-interval '1 day'+interval '23 hour 20 minute',null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555559','90000000-0000-0000-0000-000000000001','confirmed','win','pending','confirmed',now()-interval '2 day'+interval '21 hour',null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555559','90000000-0000-0000-0000-000000000003','confirmed','loss','pending','confirmed',now()-interval '2 day'+interval '21 hour 15 minute',null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555559','90000000-0000-0000-0000-000000000007','confirmed','loss','pending','disputed',null,now()-interval '2 day'+interval '22 hour','Tỷ số host submit không đúng với kết quả thực tế.','pending',null,null),
('55555555-5555-5555-5555-555555555562','90000000-0000-0000-0000-000000000001','confirmed','pending','pending','not_submitted',null,null,null,'pending',null,null),
('55555555-5555-5555-5555-555555555562','90000000-0000-0000-0000-000000000003','confirmed','pending','pending','not_submitted',null,null,null,'not_played',now()-interval '4 day'+interval '20 hour 45 minute','Host không có mặt, trận không diễn ra.'),
('55555555-5555-5555-5555-555555555562','90000000-0000-0000-0000-000000000004','confirmed','pending','pending','not_submitted',null,null,null,'not_played',now()-interval '4 day'+interval '20 hour 50 minute','Đến sân nhưng không thấy host.'),
('55555555-5555-5555-5555-555555555562','90000000-0000-0000-0000-000000000007','confirmed','pending','pending','not_submitted',null,null,null,'not_played',now()-interval '4 day'+interval '20 hour 55 minute','Cả nhóm xác nhận trận bị ghost.');

insert into public.join_requests (match_id,player_id,status,intro_note,host_response_template) values
('55555555-5555-5555-5555-555555555552','90000000-0000-0000-0000-000000000006','pending','Mình mới qua placement nhưng giữ bóng khá ổn.','Đợi mình gom đủ người rồi báo nhé.'),
('55555555-5555-5555-5555-555555555551','90000000-0000-0000-0000-000000000007','accepted','Mình vào giao lưu nhẹ nhàng.',null)
on conflict (match_id,player_id) do update set status=excluded.status,intro_note=excluded.intro_note,host_response_template=excluded.host_response_template;

insert into public.notifications (id,player_id,type,title,body,deep_link,is_read,created_at) values
('66666666-6666-6666-6666-666666666661','90000000-0000-0000-0000-000000000002','join_request','Có yêu cầu tham gia mới','Có người muốn vào kèo chờ duyệt của bạn.','/session/55555555-5555-5555-5555-555555555552',false,now()),
('66666666-6666-6666-6666-666666666670','90000000-0000-0000-0000-000000000003','session_results_submitted','Host đã gửi kết quả','Hãy vào xem và xác nhận kết quả của trận vừa xong.','/session/55555555-5555-5555-5555-555555555558',false,now()-interval '1 day'),
('66666666-6666-6666-6666-666666666671','90000000-0000-0000-0000-000000000001','session_results_disputed','Có tranh chấp kết quả','Một người chơi vừa báo sai kết quả trận đấu.','/session/55555555-5555-5555-5555-555555555559',false,now()-interval '2 day'),
('66666666-6666-6666-6666-666666666674','90000000-0000-0000-0000-000000000001','ghost_session_voided','Kèo bị đánh dấu không diễn ra','Người chơi đã báo trận đấu không diễn ra và session bị void.','/session/55555555-5555-5555-5555-555555555562',false,now()-interval '4 day');

insert into public.ratings (id,session_id,rater_id,rated_id,tags,no_show,skill_validation,is_hidden,reveal_at,processed_at,created_at) values
('77777777-7777-7777-7777-777777777771','55555555-5555-5555-5555-555555555557','90000000-0000-0000-0000-000000000003','90000000-0000-0000-0000-000000000001',array['friendly','fair_play','good_description','well_organized'],false,'matched',false,now()-interval '6 day',now()-interval '6 day',now()-interval '6 day'),
('77777777-7777-7777-7777-777777777772','55555555-5555-5555-5555-555555555557','90000000-0000-0000-0000-000000000004','90000000-0000-0000-0000-000000000001',array['on_time','good_description','fair_pairing'],false,'outclass',false,now()-interval '6 day',now()-interval '6 day',now()-interval '6 day'),
('77777777-7777-7777-7777-777777777773','55555555-5555-5555-5555-555555555557','90000000-0000-0000-0000-000000000001','90000000-0000-0000-0000-000000000003',array['friendly','skilled','on_time'],false,'matched',false,now()-interval '6 day',now()-interval '6 day',now()-interval '6 day');

commit;

-- Accounts:
-- host.confirmed@picklematch.vn / Pickle123!
-- host.approval@picklematch.vn / Pickle123!
-- player.matched@picklematch.vn / Pickle123!
-- player.lower@picklematch.vn / Pickle123!
-- host.provisional@picklematch.vn / Pickle123!
-- player.social@picklematch.vn / Pickle123!


