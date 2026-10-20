-- 全部为虚构教学样例，不代表任何真实高校规定。不自动执行，不覆盖已有记录。
INSERT INTO campus_student(user_id,college,major,study_year,plan_version,completed_credits,student_status) VALUES
 ('campus-demo-year2','计算机学院','计算机科学与技术',2,'CS-2024',45,'ACTIVE'),
 ('campus-demo-year4','计算机学院','计算机科学与技术',4,'CS-2022',120,'ACTIVE'),
 ('campus-demo-low-credit','计算机学院','计算机科学与技术',4,'CS-2022',80,'ACTIVE'),
 ('campus-demo-no-prereq','计算机学院','计算机科学与技术',4,'CS-2022',120,'ACTIVE'),
 ('campus-demo-unknown-plan','计算机学院','计算机科学与技术',4,'CS-UNKNOWN',120,'ACTIVE'),
 ('campus-demo-suspended','计算机学院','计算机科学与技术',4,'CS-2022',120,'SUSPENDED'),
 ('campus-demo-retake','计算机学院','计算机科学与技术',2,'CS-2024',45,'ACTIVE')
ON CONFLICT DO NOTHING;
INSERT INTO campus_course(course_code,name,semester,credits,remaining_seats,selection_open) VALUES
 ('CS201','数据结构','2026-2027-1',4,30,TRUE),
 ('CS401','毕业设计','2026-2027-1',8,2,TRUE),
 ('CS402','人工智能导论','2026-2027-1',3,10,TRUE)
ON CONFLICT DO NOTHING;
INSERT INTO campus_transcript(user_id,course_code,result) VALUES
 ('campus-demo-year2','CS201','PASSED'),
 ('campus-demo-year4','CS201','PASSED'),
 ('campus-demo-low-credit','CS201','PASSED'),
 ('campus-demo-unknown-plan','CS201','PASSED'),
 ('campus-demo-suspended','CS201','PASSED'),
 ('campus-demo-retake','CS201','PASSED'),
 ('campus-demo-retake','CS402','FAILED')
ON CONFLICT DO NOTHING;
INSERT INTO campus_course_rule(rule_id,course_code,major,plan_version,min_year,max_year,min_credits,
 prerequisite_course_code,source_title,source_section,rule_text,valid_from,valid_until) VALUES
 ('CS2024-CS401','CS401','计算机科学与技术','CS-2024',4,4,100,'CS201',
  '示例计算机专业培养方案 CS-2024','第4条 毕业设计','第4学年且已修至少100学分，通过CS201后可选毕业设计。','2020-01-01','2100-12-31'),
 ('CS2022-CS401','CS401','计算机科学与技术','CS-2022',4,4,100,'CS201',
  '示例计算机专业培养方案 CS-2022','第4条 毕业设计','第4学年且已修至少100学分，通过CS201后可选毕业设计。','2020-01-01','2100-12-31'),
 ('CS2024-CS402','CS402','计算机科学与技术','CS-2024',2,4,30,'CS201',
  '示例计算机专业培养方案 CS-2024','第3条 人工智能导论','第2至4学年，已修至少30学分且通过CS201，可选人工智能导论。','2020-01-01','2100-12-31'),
 ('CS2022-CS402','CS402','计算机科学与技术','CS-2022',2,4,30,'CS201',
  '示例计算机专业培养方案 CS-2022','第3条 人工智能导论','第2至4学年，已修至少30学分且通过CS201，可选人工智能导论。','2020-01-01','2100-12-31'),
 ('CS2024-CS201','CS201','计算机科学与技术','CS-2024',1,4,0,NULL,
  '示例计算机专业培养方案 CS-2024','第2条 数据结构','第1至4学年可以选修数据结构。','2020-01-01','2100-12-31'),
 ('CS2022-CS201','CS201','计算机科学与技术','CS-2022',1,4,0,NULL,
  '示例计算机专业培养方案 CS-2022','第2条 数据结构','第1至4学年可以选修数据结构。','2020-01-01','2100-12-31')
ON CONFLICT DO NOTHING;
