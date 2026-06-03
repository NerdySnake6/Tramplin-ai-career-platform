import { el, currentRoleLabel, normalizeText, normalizeUrl } from './utils.js';

export function createProfileController({
    state,
    renderWorkspaceHero,
    refreshFieldCounters,
}) {
    function setEmployerRequired(enabled) {
        el('profileCompanyName').required = enabled;
    }

    function fillApplicantProfile(profile) {
        el('profileFullName').value = profile?.full_name || '';
        el('profileUniversity').value = profile?.university || '';
        el('profileCourse').value = profile?.course_or_year || '';
        el('profileBio').value = profile?.bio || '';
        el('profileSkills').value = profile?.skills || '';
        el('profileExperience').value = profile?.experience || '';
        el('profileGithub').value = profile?.github_url || '';
        el('profilePortfolio').value = profile?.portfolio_url || '';
        el('profilePublic').checked = Boolean(profile?.is_profile_public);
        el('profileShowResponses').checked = Boolean(profile?.show_responses);
        refreshFieldCounters();
    }

    function fillEmployerProfile(profile) {
        el('profileCompanyName').value = profile?.company_name || '';
        el('profileCompanyDescription').value = profile?.description || '';
        el('profileIndustry').value = profile?.industry || '';
        el('profileWebsite').value = profile?.website || '';
        el('profileSocialLinks').value = profile?.social_links || '';
        el('profileCity').value = profile?.city || '';
        el('profileAddress').value = profile?.address || '';
        refreshFieldCounters();
    }

    function renderProfileSection() {
        const form = el('profileForm');
        const guestHint = el('profileGuestHint');
        const status = el('profileStatusText');
        const applicantFields = el('applicantProfileFields');
        const employerFields = el('employerProfileFields');
        const passwordForm = el('passwordForm');

        if (!state.currentUser) {
            form.classList.add('d-none');
            passwordForm.classList.add('d-none');
            guestHint.classList.remove('d-none');
            status.textContent = 'Гость';
            setEmployerRequired(false);
            renderWorkspaceHero();
            refreshFieldCounters();
            return;
        }

        form.classList.remove('d-none');
        passwordForm.classList.toggle('d-none', state.currentUser.role === 'admin');
        guestHint.classList.add('d-none');
        status.textContent = currentRoleLabel(state.currentUser.role);
        el('profileDisplayName').value = state.currentUser.display_name || '';

        if (state.currentUser.role === 'applicant') {
            applicantFields.classList.remove('d-none');
            employerFields.classList.add('d-none');
            setEmployerRequired(false);
            fillApplicantProfile(state.profile?.applicant_profile);
        } else if (state.currentUser.role === 'employer') {
            employerFields.classList.remove('d-none');
            applicantFields.classList.add('d-none');
            setEmployerRequired(true);
            fillEmployerProfile(state.profile?.employer_profile);
        } else {
            applicantFields.classList.add('d-none');
            employerFields.classList.add('d-none');
            setEmployerRequired(false);
        }
        renderWorkspaceHero();
        refreshFieldCounters();
    }

    function buildProfilePayload() {
        const payload = {
            display_name: normalizeText(el('profileDisplayName').value),
        };

        if (!state.currentUser) return payload;

        if (state.currentUser.role === 'applicant') {
            payload.applicant_profile = {
                full_name: normalizeText(el('profileFullName').value),
                university: normalizeText(el('profileUniversity').value),
                course_or_year: normalizeText(el('profileCourse').value),
                bio: normalizeText(el('profileBio').value),
                skills: normalizeText(el('profileSkills').value),
                experience: normalizeText(el('profileExperience').value),
                github_url: normalizeUrl(el('profileGithub').value),
                portfolio_url: normalizeUrl(el('profilePortfolio').value),
                is_profile_public: el('profilePublic').checked,
                show_responses: el('profileShowResponses').checked,
            };
        }

        if (state.currentUser.role === 'employer') {
            payload.employer_profile = {
                company_name: normalizeText(el('profileCompanyName').value),
                description: normalizeText(el('profileCompanyDescription').value),
                industry: normalizeText(el('profileIndustry').value),
                website: normalizeUrl(el('profileWebsite').value),
                social_links: normalizeText(el('profileSocialLinks').value),
                city: normalizeText(el('profileCity').value),
                address: normalizeText(el('profileAddress').value),
            };
        }

        return payload;
    }

    return {
        renderProfileSection,
        buildProfilePayload,
    };
}
