-- 教务演示业务表，复用现有 PostgreSQL 业务数据源；不修改商城表。
CREATE TABLE IF NOT EXISTS campus_student (
    user_id VARCHAR(64) PRIMARY KEY,
    college VARCHAR(100) NOT NULL,
    major VARCHAR(100) NOT NULL,
    study_year INTEGER NOT NULL CHECK (study_year BETWEEN 1 AND 8),
    plan_version VARCHAR(32) NOT NULL,
    completed_credits NUMERIC(6,1) NOT NULL CHECK (completed_credits >= 0),
    student_status VARCHAR(20) NOT NULL CHECK (student_status IN ('ACTIVE','SUSPENDED','GRADUATED'))
);
CREATE TABLE IF NOT EXISTS campus_course (
    course_code VARCHAR(32) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    semester VARCHAR(32) NOT NULL,
    credits NUMERIC(4,1) NOT NULL CHECK (credits > 0),
    remaining_seats INTEGER NOT NULL CHECK (remaining_seats >= 0),
    selection_open BOOLEAN NOT NULL DEFAULT FALSE
);
CREATE TABLE IF NOT EXISTS campus_transcript (
    user_id VARCHAR(64) NOT NULL REFERENCES campus_student(user_id),
    course_code VARCHAR(32) NOT NULL,
    result VARCHAR(10) NOT NULL CHECK (result IN ('PASSED','FAILED')),
    PRIMARY KEY (user_id, course_code)
);
CREATE TABLE IF NOT EXISTS campus_course_rule (
    rule_id VARCHAR(64) PRIMARY KEY,
    course_code VARCHAR(32) NOT NULL REFERENCES campus_course(course_code),
    major VARCHAR(100) NOT NULL,
    plan_version VARCHAR(32) NOT NULL,
    min_year INTEGER NOT NULL CHECK (min_year >= 1),
    max_year INTEGER NOT NULL CHECK (max_year >= min_year),
    min_credits NUMERIC(6,1) NOT NULL CHECK (min_credits >= 0),
    prerequisite_course_code VARCHAR(32),
    source_title VARCHAR(200) NOT NULL,
    source_section VARCHAR(100) NOT NULL,
    rule_text TEXT NOT NULL,
    valid_from DATE NOT NULL,
    valid_until DATE NOT NULL CHECK (valid_until >= valid_from)
);
CREATE INDEX IF NOT EXISTS idx_campus_rule_scope
    ON campus_course_rule(course_code, major, plan_version, valid_from, valid_until);
CREATE TABLE IF NOT EXISTS campus_enrollment (
    enrollment_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES campus_student(user_id),
    course_code VARCHAR(32) NOT NULL REFERENCES campus_course(course_code),
    semester VARCHAR(32) NOT NULL,
    enrollment_type VARCHAR(10) NOT NULL CHECK (enrollment_type IN ('NORMAL','RETAKE')),
    rule_id VARCHAR(64) NOT NULL REFERENCES campus_course_rule(rule_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, course_code, semester)
);
CREATE TABLE IF NOT EXISTS campus_leave_application (
    application_id VARCHAR(64) PRIMARY KEY,
    user_id VARCHAR(64) NOT NULL REFERENCES campus_student(user_id),
    request_id VARCHAR(64) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL CHECK (end_date >= start_date),
    reason VARCHAR(500) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','APPROVED','REJECTED')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, request_id)
);
