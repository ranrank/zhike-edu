-- 仅为实际登录的初始化管理员补充一份虚构大二档案，不覆盖已绑定档案。
-- currentUserId 来自 /user/me，且由 CampusInitMain 校验为纯数字。
WITH inserted_student AS (
 INSERT INTO campus_student(user_id,college,major,study_year,plan_version,completed_credits,student_status)
 VALUES ('${currentUserId}','计算机学院','计算机科学与技术',2,'CS-2024',45,'ACTIVE')
 ON CONFLICT DO NOTHING RETURNING user_id
)
INSERT INTO campus_transcript(user_id,course_code,result)
SELECT user_id,'CS201','PASSED' FROM inserted_student
ON CONFLICT DO NOTHING;
